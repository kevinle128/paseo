import { runAcpProvider } from "@getpaseo/plugin/server/acp";
import {
  ProviderInputSchema,
  requireProviderCapabilities,
  type ProviderCapability,
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

type ConfigureInput = Extract<ProviderInput, { type: "session.configure" }>;
type SessionConfigEvent = Extract<ProviderEvent, { type: "session.config" }>;

interface QueuedConfigure {
  input: ConfigureInput;
  wantsFullAccess: boolean | undefined;
}

interface ActiveConfigure {
  requestId: string;
  wantsFullAccess: boolean | undefined;
  heldConfigEvents: SessionConfigEvent[];
}

function wrapConnection(inner: ProviderConnection, launch: ProviderLaunch): ProviderConnection {
  const listeners = new Set<(event: ProviderEvent) => void>();
  const activeSessions = new Set<string>();
  const sessionCapabilities = new Map<string, readonly ProviderCapability[]>();
  const fullAccessSessions = new Set<string>();
  const closedSessions = new Set<string>();
  const pendingOpens = new Map<string, { sessionId: string; wantsFullAccess: boolean }>();
  const activeConfigures = new Map<string, ActiveConfigure>();
  const queuedConfigures = new Map<string, QueuedConfigure[]>();
  const autoApprovedPermissions = new Set<string>();
  let closed = false;

  function emit(event: ProviderEvent): void {
    if (closed) return;
    for (const listener of listeners) listener(event);
  }

  function hasPendingOpen(sessionId: string): boolean {
    for (const pending of pendingOpens.values()) {
      if (pending.sessionId === sessionId) return true;
    }
    return false;
  }

  function clearSessionPermissions(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const key of autoApprovedPermissions) {
      if (key.startsWith(prefix)) autoApprovedPermissions.delete(key);
    }
  }

  function failQueuedConfigures(sessionId: string, message: string): void {
    const queued = queuedConfigures.get(sessionId);
    queuedConfigures.delete(sessionId);
    if (!queued) return;
    for (const entry of queued) {
      emit({
        type: "request.failed",
        requestId: entry.input.requestId,
        error: { message },
      });
    }
  }

  function clearPendingSessionState(sessionId: string): void {
    for (const [requestId, pending] of pendingOpens) {
      if (pending.sessionId === sessionId) pendingOpens.delete(requestId);
    }
    activeConfigures.delete(sessionId);
    failQueuedConfigures(sessionId, `Unknown session: ${sessionId}`);
  }

  function takeActiveConfigureByRequestId(
    requestId: string,
  ): { sessionId: string; active: ActiveConfigure } | undefined {
    for (const [sessionId, active] of activeConfigures) {
      if (active.requestId !== requestId) continue;
      activeConfigures.delete(sessionId);
      return { sessionId, active };
    }
    return undefined;
  }

  function emitSessionConfig(event: SessionConfigEvent): void {
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
  }

  function startNextQueuedConfigure(sessionId: string): void {
    if (closed || activeConfigures.has(sessionId) || !activeSessions.has(sessionId)) return;
    const queue = queuedConfigures.get(sessionId);
    if (!queue || queue.length === 0) return;
    const next = queue.shift()!;
    if (queue.length === 0) queuedConfigures.delete(sessionId);
    const active: ActiveConfigure = {
      requestId: next.input.requestId,
      wantsFullAccess: next.wantsFullAccess,
      heldConfigEvents: [],
    };
    activeConfigures.set(sessionId, active);
    void inner.send(next.input).catch((error) => {
      if (activeConfigures.get(sessionId) === active) {
        activeConfigures.delete(sessionId);
        for (const held of active.heldConfigEvents) {
          emitSessionConfig(held);
        }
      }
      emit({
        type: "request.failed",
        requestId: next.input.requestId,
        error: { message: error instanceof Error ? error.message : String(error) },
      });
      startNextQueuedConfigure(sessionId);
    });
  }

  function settleRequestState(event: ProviderEvent): void {
    if (event.type === "session.opened") {
      activeSessions.add(event.sessionId);
      sessionCapabilities.set(event.sessionId, event.capabilities);
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
    if (event.type === "session.closed" || event.type === "session.runtime_failed") {
      activeSessions.delete(event.sessionId);
      sessionCapabilities.delete(event.sessionId);
      closedSessions.add(event.sessionId);
      fullAccessSessions.delete(event.sessionId);
      clearSessionPermissions(event.sessionId);
      clearPendingSessionState(event.sessionId);
      return;
    }
    if (event.type === "request.failed") {
      pendingOpens.delete(event.requestId);
    }
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
    if (event.type === "session.config") {
      const active = activeConfigures.get(event.sessionId);
      if (active) {
        active.heldConfigEvents.push(event);
        return;
      }
      emitSessionConfig(event);
      return;
    }
    if (event.type === "request.completed" || event.type === "request.failed") {
      const finished = takeActiveConfigureByRequestId(event.requestId);
      if (finished) {
        const { sessionId, active } = finished;
        if (event.type === "request.completed") {
          for (const held of active.heldConfigEvents.slice(0, -1)) {
            emitSessionConfig(held);
          }
          if (active.wantsFullAccess === true) fullAccessSessions.add(sessionId);
          else if (active.wantsFullAccess === false) fullAccessSessions.delete(sessionId);
          const committed = active.heldConfigEvents.at(-1);
          if (committed) emitSessionConfig(committed);
        } else {
          for (const held of active.heldConfigEvents) {
            emitSessionConfig(held);
          }
        }
        emit(event);
        startNextQueuedConfigure(sessionId);
        return;
      }
    }
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
        if (activeSessions.has(parsed.sessionId) || hasPendingOpen(parsed.sessionId)) {
          throw new Error(`Session already exists: ${parsed.sessionId}`);
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
        pendingOpens.set(parsed.requestId, {
          sessionId: parsed.sessionId,
          wantsFullAccess,
        });
        try {
          await inner.send({
            ...parsed,
            persistence,
            config: wantsFullAccess
              ? { ...parsed.config, mode: NATIVE_FULL_ACCESS_BASE_MODE }
              : parsed.config,
          });
        } catch (error) {
          pendingOpens.delete(parsed.requestId);
          throw error;
        }
        return;
      }
      if (input.type === "session.configure") {
        const parsed = ProviderInputSchema.parse(input);
        if (parsed.type !== "session.configure") {
          await inner.send(parsed);
          return;
        }
        const modeChange = parsed.changes.mode;
        const wantsFullAccess =
          modeChange === undefined ? undefined : modeChange === FULL_ACCESS_MODE_ID;
        const forwarded: ConfigureInput = wantsFullAccess
          ? { ...parsed, changes: { ...parsed.changes, mode: NATIVE_FULL_ACCESS_BASE_MODE } }
          : parsed;
        if (activeConfigures.has(parsed.sessionId)) {
          const capabilities = sessionCapabilities.get(parsed.sessionId);
          if (!capabilities) throw new Error(`Unknown session: ${parsed.sessionId}`);
          requireProviderCapabilities(capabilities, parsed);
          const queue = queuedConfigures.get(parsed.sessionId) ?? [];
          queue.push({ input: forwarded, wantsFullAccess });
          queuedConfigures.set(parsed.sessionId, queue);
          return;
        }
        const active: ActiveConfigure = {
          requestId: parsed.requestId,
          wantsFullAccess,
          heldConfigEvents: [],
        };
        activeConfigures.set(parsed.sessionId, active);
        try {
          await inner.send(forwarded);
        } catch (error) {
          if (activeConfigures.get(parsed.sessionId) === active) {
            activeConfigures.delete(parsed.sessionId);
            for (const held of active.heldConfigEvents) {
              emitSessionConfig(held);
            }
          }
          throw error;
        }
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
        sessionCapabilities.delete(input.sessionId);
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
      sessionCapabilities.clear();
      fullAccessSessions.clear();
      closedSessions.clear();
      pendingOpens.clear();
      activeConfigures.clear();
      queuedConfigures.clear();
      autoApprovedPermissions.clear();
      listeners.clear();
    },
  };
}
