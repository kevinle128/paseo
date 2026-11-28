import { runAcpProvider } from "@getpaseo/plugin/server/acp";
import {
  ProviderInputSchema,
  requireProviderCapabilities,
  type ProviderConnection,
  type ProviderEvent,
  type ProviderInput,
  type ProviderLaunch,
  type ProviderPermissionAction,
  type ProviderPersistence,
  type ProviderRegistration,
} from "@getpaseo/plugin/server/provider";
import { z } from "zod";
import {
  FULL_ACCESS_MODE_ID,
  NATIVE_FULL_ACCESS_BASE_MODE,
  acpLaunch,
  cachedModelVariants,
  catalogCacheKey,
  enrichModels,
  enrichModes,
  getStatus,
  refreshModelVariants,
} from "./internal/catalog.js";
import { antigravityAcpTransformer, mapAntigravityTimelineItem } from "./internal/timeline.js";

const persistenceDataSchema = z.union([
  z.object({ sessionId: z.string().min(1) }).strict(),
  // Legacy stream-json sessions stored `conversationId`; `agy acp` loads that exact UUID as `sessionId`.
  z.object({ conversationId: z.string().min(1) }).strict(),
]);

const persistenceSchema = z.object({ version: z.literal(1), data: persistenceDataSchema }).strict();

function normalizePersistence(
  persistence: ProviderPersistence | undefined,
): ProviderPersistence | undefined {
  if (!persistence) return undefined;
  const parsed = persistenceSchema.parse(persistence);
  const sessionId = "sessionId" in parsed.data ? parsed.data.sessionId : parsed.data.conversationId;
  return { version: 1, data: { sessionId } };
}

// Guard against auto-answering ACP chooser prompts (multiple non-approval choices without a deny action).
function selectAutoAllowAction(
  actions: readonly ProviderPermissionAction[] | undefined,
): ProviderPermissionAction | null {
  if (!actions || actions.length === 0) return null;
  const hasDeny = actions.some((action) => action.behavior === "deny");
  if (!hasDeny) return null;
  const allows = actions.filter((action) => action.behavior === "allow");
  if (allows.length === 0 || !allows.every((action) => /^allow(?:$|[_-])/.test(action.id))) {
    return null;
  }
  return (
    allows.find(
      (action) =>
        action.id === "allow" || action.id === "allow_once" || action.id === "allow-once",
    ) ?? allows[0]!
  );
}

export function createAntigravityProvider(): ProviderRegistration {
  const base = runAcpProvider({
    id: "antigravity",
    label: "Antigravity",
    description: "Antigravity CLI on your host",
    icon: "icon.svg",
    command: ["agy", "acp"],
    acpOptions: {
      startupTimeoutMs: 30_000,
      waitForInitialCommands: true,
    },
    transformers: [antigravityAcpTransformer],
  });

  return {
    ...base,
    async status({ launch }) {
      if (!launch) {
        return {
          available: false,
          diagnostic: "agy not found on PATH. Install Antigravity, then run `agy` and sign in.",
        };
      }
      return getStatus(launch);
    },
    async getCatalogCacheKey({ launch }) {
      if (!launch) return undefined;
      return catalogCacheKey(launch);
    },
    async connect(request) {
      if (!request.launch) {
        throw new Error("The daemon must supply the Antigravity launch");
      }
      const launch = acpLaunch(request.launch);
      await refreshModelVariants(launch);
      const inner = await base.connect({ ...request, launch });
      return wrapConnection(inner, launch);
    },
  };
}

function wrapConnection(inner: ProviderConnection, launch: ProviderLaunch): ProviderConnection {
  const listeners = new Set<(event: ProviderEvent) => void>();
  const activeSessions = new Set<string>();
  const fullAccessSessions = new Set<string>();
  const closedSessions = new Set<string>();
  const pendingOpens = new Map<string, { sessionId: string; wantsFullAccess: boolean }>();
  const pendingConfigures = new Map<
    string,
    Array<{ requestId: string; wantsFullAccess: boolean | undefined }>
  >();
  const autoApprovedPermissions = new Set<string>();
  let closed = false;

  function emit(event: ProviderEvent): void {
    if (closed) return;
    for (const listener of listeners) listener(event);
  }

  function clearSessionPermissions(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const key of autoApprovedPermissions) {
      if (key.startsWith(prefix)) autoApprovedPermissions.delete(key);
    }
  }

  function clearPendingSessionState(sessionId: string): void {
    for (const [requestId, pending] of pendingOpens) {
      if (pending.sessionId === sessionId) pendingOpens.delete(requestId);
    }
    pendingConfigures.delete(sessionId);
  }

  function removePendingConfigure(requestId: string): void {
    for (const [sessionId, queue] of pendingConfigures) {
      const index = queue.findIndex((entry) => entry.requestId === requestId);
      if (index === -1) continue;
      queue.splice(index, 1);
      if (queue.length === 0) pendingConfigures.delete(sessionId);
      return;
    }
  }

  function applyCommittedConfigure(sessionId: string): void {
    const queue = pendingConfigures.get(sessionId);
    if (!queue || queue.length === 0) return;
    const head = queue.shift()!;
    if (queue.length === 0) pendingConfigures.delete(sessionId);
    if (head.wantsFullAccess === true) fullAccessSessions.add(sessionId);
    else if (head.wantsFullAccess === false) fullAccessSessions.delete(sessionId);
  }

  function settleRequestState(event: ProviderEvent): void {
    if (event.type === "session.opened") {
      activeSessions.add(event.sessionId);
      closedSessions.delete(event.sessionId);
      if (event.requestId) {
        const pending = pendingOpens.get(event.requestId);
        if (pending) {
          pendingOpens.delete(event.requestId);
          if (pending.wantsFullAccess) fullAccessSessions.add(event.sessionId);
          else fullAccessSessions.delete(event.sessionId);
        }
      }
      return;
    }
    if (event.type === "session.ready" && event.requestId) {
      pendingOpens.delete(event.requestId);
      return;
    }
    if (event.type === "request.completed") {
      removePendingConfigure(event.requestId);
      return;
    }
    if (event.type === "session.closed" || event.type === "session.runtime_failed") {
      activeSessions.delete(event.sessionId);
      closedSessions.add(event.sessionId);
      fullAccessSessions.delete(event.sessionId);
      clearSessionPermissions(event.sessionId);
      clearPendingSessionState(event.sessionId);
      return;
    }
    if (event.type !== "request.failed") return;
    pendingOpens.delete(event.requestId);
    removePendingConfigure(event.requestId);
  }

  function resolveSessionMode(
    sessionId: string,
    nativeMode: string | undefined,
  ): string | undefined {
    if (!fullAccessSessions.has(sessionId)) return nativeMode;
    if (nativeMode === NATIVE_FULL_ACCESS_BASE_MODE || nativeMode === undefined) {
      return FULL_ACCESS_MODE_ID;
    }
    fullAccessSessions.delete(sessionId);
    return nativeMode;
  }

  function autoApproveIfEligible(
    event: Extract<ProviderEvent, { type: "session.permission" }>,
  ): boolean {
    if (!fullAccessSessions.has(event.sessionId) || closedSessions.has(event.sessionId)) {
      return false;
    }
    const allow = selectAutoAllowAction(event.request.actions);
    if (!allow) return false;
    const key = `${event.sessionId}:${event.request.id}`;
    autoApprovedPermissions.add(key);
    void inner
      .send({
        type: "session.permission",
        sessionId: event.sessionId,
        permissionId: event.request.id,
        response: { behavior: "allow", selectedActionId: allow.id },
      })
      .catch(() => {
        autoApprovedPermissions.delete(key);
      });
    return true;
  }

  inner.onEvent((event) => {
    settleRequestState(event);
    if (event.type === "catalog") {
      const variants = cachedModelVariants(launch);
      emit({
        ...event,
        catalog: {
          ...event.catalog,
          models: enrichModels(event.catalog.models, variants, event.catalog.defaultThinkingOption),
          modes: enrichModes(event.catalog.modes),
          ...(variants.size > 0 ? { thinkingOptions: [], defaultThinkingOption: undefined } : {}),
        },
      });
      return;
    }
    if (event.type === "session.config") {
      applyCommittedConfigure(event.sessionId);
      const variants = cachedModelVariants(launch);
      emit({
        ...event,
        config: {
          ...event.config,
          mode: resolveSessionMode(event.sessionId, event.config.mode),
          models: enrichModels(event.config.models, variants, event.config.thinkingOption),
          modes: enrichModes(event.config.modes),
        },
      });
      return;
    }
    if (event.type === "session.permission" && autoApproveIfEligible(event)) {
      return;
    }
    if (
      event.type === "session.permission_resolved" &&
      autoApprovedPermissions.delete(`${event.sessionId}:${event.permissionId}`)
    ) {
      return;
    }
    if (event.type === "timeline.item") {
      emit({ ...event, item: mapAntigravityTimelineItem(event.item) });
      return;
    }
    emit(event);
  });

  return {
    version: inner.version,
    capabilities: inner.capabilities,
    async send(input: ProviderInput) {
      if (closed) throw new Error("ACP provider connection is closed");
      if (input.type === "catalog") {
        await refreshModelVariants(launch, input.cwd);
        await inner.send(input);
        return;
      }
      if (input.type === "session.open") {
        const parsed = ProviderInputSchema.parse(input);
        if (parsed.type !== "session.open") {
          await inner.send(parsed);
          return;
        }
        requireProviderCapabilities(inner.capabilities, parsed);
        if (activeSessions.has(parsed.sessionId)) {
          await inner.send(parsed);
          return;
        }
        let persistence: ProviderPersistence | undefined;
        try {
          persistence = normalizePersistence(parsed.persistence);
        } catch (error) {
          emit({
            type: "request.failed",
            requestId: parsed.requestId,
            error: { message: error instanceof Error ? error.message : String(error) },
          });
          return;
        }
        const wantsFullAccess = parsed.config.mode === FULL_ACCESS_MODE_ID;
        await inner.send({
          ...parsed,
          persistence,
          config: wantsFullAccess
            ? { ...parsed.config, mode: NATIVE_FULL_ACCESS_BASE_MODE }
            : parsed.config,
        });
        pendingOpens.set(parsed.requestId, {
          sessionId: parsed.sessionId,
          wantsFullAccess,
        });
        return;
      }
      if (input.type === "session.configure") {
        const modeChange = input.changes?.mode;
        const wantsFullAccess =
          modeChange === undefined ? undefined : modeChange === FULL_ACCESS_MODE_ID;
        await inner.send(
          wantsFullAccess
            ? { ...input, changes: { ...input.changes, mode: NATIVE_FULL_ACCESS_BASE_MODE } }
            : input,
        );
        const queue = pendingConfigures.get(input.sessionId) ?? [];
        queue.push({ requestId: input.requestId, wantsFullAccess });
        pendingConfigures.set(input.sessionId, queue);
        return;
      }
      if (input.type === "session.close") {
        const wasClosed = closedSessions.has(input.sessionId);
        closedSessions.add(input.sessionId);
        try {
          await inner.send(input);
        } catch (error) {
          if (!wasClosed) closedSessions.delete(input.sessionId);
          throw error;
        }
        activeSessions.delete(input.sessionId);
        fullAccessSessions.delete(input.sessionId);
        clearSessionPermissions(input.sessionId);
        clearPendingSessionState(input.sessionId);
        return;
      }
      await inner.send(input);
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      closed = true;
      await inner.close();
      activeSessions.clear();
      fullAccessSessions.clear();
      closedSessions.clear();
      pendingOpens.clear();
      pendingConfigures.clear();
      autoApprovedPermissions.clear();
      listeners.clear();
    },
  };
}
