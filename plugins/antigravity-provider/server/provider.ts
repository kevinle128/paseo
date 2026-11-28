import { runAcpProvider } from "@getpaseo/plugin/server/acp";
import type {
  ProviderConnection,
  ProviderEvent,
  ProviderInput,
  ProviderLaunch,
  ProviderPermissionAction,
  ProviderPersistence,
  ProviderRegistration,
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
  return allows.find((action) => action.id === "allow" || action.id === "allow_once") ?? allows[0]!;
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
  const fullAccessSessions = new Set<string>();
  const closedSessions = new Set<string>();
  const pendingOpens = new Map<string, string>();
  const pendingModeChanges = new Map<string, { sessionId: string; previous: boolean }>();
  const autoApprovedPermissions = new Set<string>();

  function emit(event: ProviderEvent): void {
    for (const listener of listeners) listener(event);
  }

  function hasPendingModeMutation(sessionId: string): boolean {
    for (const openedSession of pendingOpens.values()) {
      if (openedSession === sessionId) return true;
    }
    for (const change of pendingModeChanges.values()) {
      if (change.sessionId === sessionId) return true;
    }
    return false;
  }

  function clearSessionPermissions(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const key of autoApprovedPermissions) {
      if (key.startsWith(prefix)) autoApprovedPermissions.delete(key);
    }
  }

  function settleRequestState(event: ProviderEvent): void {
    if (event.type === "session.ready" && event.requestId) {
      pendingOpens.delete(event.requestId);
      return;
    }
    if (event.type === "request.completed") {
      pendingModeChanges.delete(event.requestId);
      return;
    }
    if (event.type === "session.closed" || event.type === "session.runtime_failed") {
      closedSessions.add(event.sessionId);
      fullAccessSessions.delete(event.sessionId);
      clearSessionPermissions(event.sessionId);
      return;
    }
    if (event.type !== "request.failed") return;
    const openedSession = pendingOpens.get(event.requestId);
    if (openedSession) {
      pendingOpens.delete(event.requestId);
      fullAccessSessions.delete(openedSession);
    }
    const modeChange = pendingModeChanges.get(event.requestId);
    if (modeChange) {
      pendingModeChanges.delete(event.requestId);
      if (modeChange.previous) fullAccessSessions.add(modeChange.sessionId);
      else fullAccessSessions.delete(modeChange.sessionId);
    }
  }

  function resolveSessionMode(
    sessionId: string,
    nativeMode: string | undefined,
  ): string | undefined {
    if (!fullAccessSessions.has(sessionId)) return nativeMode;
    if (
      nativeMode === NATIVE_FULL_ACCESS_BASE_MODE ||
      nativeMode === undefined ||
      hasPendingModeMutation(sessionId)
    ) {
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
    void Promise.resolve()
      .then(() => {
        if (closedSessions.has(event.sessionId)) {
          autoApprovedPermissions.delete(key);
          return undefined;
        }
        return inner.send({
          type: "session.permission",
          sessionId: event.sessionId,
          permissionId: event.request.id,
          response: { behavior: "allow", selectedActionId: allow.id },
        });
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
      if (input.type === "catalog") {
        await refreshModelVariants(launch, input.cwd);
        await inner.send(input);
        return;
      }
      if (input.type === "session.open") {
        let persistence: ProviderPersistence | undefined;
        try {
          persistence = normalizePersistence(input.persistence);
        } catch (error) {
          emit({
            type: "request.failed",
            requestId: input.requestId,
            error: { message: error instanceof Error ? error.message : String(error) },
          });
          return;
        }
        closedSessions.delete(input.sessionId);
        const wantsFullAccess = input.config.mode === FULL_ACCESS_MODE_ID;
        if (wantsFullAccess) {
          fullAccessSessions.add(input.sessionId);
          pendingOpens.set(input.requestId, input.sessionId);
        }
        try {
          await inner.send({
            ...input,
            persistence,
            config: wantsFullAccess
              ? { ...input.config, mode: NATIVE_FULL_ACCESS_BASE_MODE }
              : input.config,
          });
        } catch (error) {
          if (wantsFullAccess) {
            pendingOpens.delete(input.requestId);
            fullAccessSessions.delete(input.sessionId);
          }
          throw error;
        }
        return;
      }
      if (input.type === "session.configure" && input.changes.mode !== undefined) {
        const previous = fullAccessSessions.has(input.sessionId);
        pendingModeChanges.set(input.requestId, { sessionId: input.sessionId, previous });
        const wantsFullAccess = input.changes.mode === FULL_ACCESS_MODE_ID;
        if (wantsFullAccess) fullAccessSessions.add(input.sessionId);
        else fullAccessSessions.delete(input.sessionId);
        try {
          await inner.send(
            wantsFullAccess
              ? { ...input, changes: { ...input.changes, mode: NATIVE_FULL_ACCESS_BASE_MODE } }
              : input,
          );
        } catch (error) {
          pendingModeChanges.delete(input.requestId);
          if (previous) fullAccessSessions.add(input.sessionId);
          else fullAccessSessions.delete(input.sessionId);
          throw error;
        }
        return;
      }
      await inner.send(input);
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      await inner.close();
      fullAccessSessions.clear();
      closedSessions.clear();
      pendingOpens.clear();
      pendingModeChanges.clear();
      autoApprovedPermissions.clear();
      listeners.clear();
    },
  };
}
