import { useEffect, useMemo, useState } from "react";
import { shallow } from "zustand/shallow";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useHosts } from "@/runtime/host-runtime";
import { usePinnedOrderSeedStore } from "@/stores/pinned-order-seed-store";
import { useSessionStore, type SessionState } from "@/stores/session-store";
import { useHydratedWorkspaceServerIds } from "@/stores/session-store-hooks";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { shouldSeedPinnedOrder } from "./pinned-order";
import { prunePinnedOrder, seedPinnedWorkspaceOrder } from "./pinned-order-seed";
import { selectPinnedEntries } from "./use-pinned-workspace-selections";

interface PersistedStore {
  persist: {
    hasHydrated: () => boolean;
    onFinishHydration: (listener: () => void) => () => void;
  };
}

function useStoreHydrated(store: PersistedStore): boolean {
  const [hydrated, setHydrated] = useState(() => store.persist.hasHydrated());
  useEffect(() => {
    setHydrated(store.persist.hasHydrated());
    return store.persist.onFinishHydration(() => setHydrated(true));
  }, [store]);
  return hydrated;
}

function selectWorkspaceMaps(sessions: Record<string, SessionState>) {
  return Object.entries(sessions).map(([serverId, session]) => ({
    serverId,
    workspaces: session.workspaces,
  }));
}

function areWorkspaceMapsEqual(
  left: ReturnType<typeof selectWorkspaceMaps>,
  right: ReturnType<typeof selectWorkspaceMaps>,
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        entry.serverId === other.serverId &&
        entry.workspaces === other.workspaces
      );
    })
  );
}

/**
 * Keeps the stored pinned order in step with the pins the hosts report: seeds it once every
 * registered host has loaded, then drops keys of workspaces that were unpinned elsewhere.
 * Web only; native keeps the recency order and never writes here.
 */
export function PinnedOrderReconciler(): null {
  const orderReady = useStoreHydrated(useSidebarOrderStore);
  const seedReady = useStoreHydrated(usePinnedOrderSeedStore);
  const ready = orderReady && seedReady;
  const seeded = usePinnedOrderSeedStore((state) => state.seeded);
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const hydratedServerIds = useHydratedWorkspaceServerIds(serverIds);
  const workspaceMaps = useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectWorkspaceMaps(state.sessions),
    areWorkspaceMapsEqual,
  );
  const pinnedEntries = useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectPinnedEntries(state.sessions),
    shallow,
  );

  useEffect(() => {
    if (!ready || !shouldSeedPinnedOrder({ seeded, serverIds, hydratedServerIds })) return;
    const pinnedAtByKey: Record<string, string> = {};
    for (const { serverId, workspaceId, pinnedAt } of pinnedEntries) {
      pinnedAtByKey[`${serverId}:${workspaceId}`] = pinnedAt;
    }
    seedPinnedWorkspaceOrder(pinnedAtByKey);
  }, [ready, seeded, serverIds, hydratedServerIds, pinnedEntries]);

  const workspacePinnedAtByKey = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const { serverId, workspaces } of workspaceMaps) {
      for (const workspace of workspaces.values()) {
        map[`${serverId}:${workspace.id}`] = workspace.pinnedAt ?? null;
      }
    }
    return map;
  }, [workspaceMaps]);

  useEffect(() => {
    if (ready && seeded) prunePinnedOrder(workspacePinnedAtByKey);
  }, [ready, seeded, workspacePinnedAtByKey]);

  return null;
}
