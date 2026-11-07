import { useMemo } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import {
  useSessionStore,
  type SessionState,
  type WorkspaceDescriptor,
} from "@/stores/session-store";
import { isWeb } from "@/constants/platform";
import { usePinnedOrderSeedStore } from "@/stores/pinned-order-seed-store";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { orderPinnedWorkspaceKeys, resolvePinnedOrderRule } from "./pinned-order";

interface PinnedEntry {
  serverId: string;
  workspaceId: string;
  pinnedAt: string;
}

function arePinnedEntriesEqual(a: PinnedEntry[], b: PinnedEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((entry, index) => {
      const other = b[index];
      return (
        other !== undefined &&
        entry.serverId === other.serverId &&
        entry.workspaceId === other.workspaceId &&
        entry.pinnedAt === other.pinnedAt
      );
    })
  );
}

const EMPTY_ENTRIES: PinnedEntry[] = [];

// Agent stream writes replace the session object but keep its `workspaces` Map, so the scan of a
// Map runs once per Map identity instead of once per store write.
const pinnedEntriesByWorkspaces = new WeakMap<Map<string, WorkspaceDescriptor>, PinnedEntry[]>();

function listPinnedEntries(
  serverId: string,
  workspaces: Map<string, WorkspaceDescriptor>,
): PinnedEntry[] {
  const cached = pinnedEntriesByWorkspaces.get(workspaces);
  if (cached) {
    return cached;
  }
  const entries: PinnedEntry[] = [];
  for (const workspace of workspaces.values()) {
    if (workspace.pinnedAt) {
      entries.push({ serverId, workspaceId: workspace.id, pinnedAt: workspace.pinnedAt });
    }
  }
  pinnedEntriesByWorkspaces.set(workspaces, entries);
  return entries;
}

export function selectPinnedEntries(sessions: Record<string, SessionState>): PinnedEntry[] {
  let pinned: PinnedEntry[] = EMPTY_ENTRIES;
  for (const [serverId, session] of Object.entries(sessions)) {
    const entries = listPinnedEntries(serverId, session.workspaces);
    if (entries.length === 0) {
      continue;
    }
    pinned = pinned === EMPTY_ENTRIES ? entries : [...pinned, ...entries];
  }
  return pinned;
}

/**
 * True when any host has a pinned workspace, without the sidebar projection. Cheap enough for
 * a subscriber that only needs presence, such as the sidebar Pinned header.
 */
export function useHasPinnedWorkspace(enabled: boolean): boolean {
  return useSessionStore((state) => enabled && selectPinnedEntries(state.sessions).length > 0);
}

/**
 * Every pinned workspace across all hosts, in the order the sidebar Pinned section uses.
 * Built from the session store rather than the sidebar projection so sidebar filters
 * (project, label, background) never hide a grid cell.
 */
export function usePinnedWorkspaceSelections(): ActiveWorkspaceSelection[] {
  const entries = useStoreWithEqualityFn(
    useSessionStore,
    (state) => selectPinnedEntries(state.sessions),
    arePinnedEntriesEqual,
  );
  const storedOrder = useSidebarOrderStore((state) => state.pinnedWorkspaceOrder);
  const seeded = usePinnedOrderSeedStore((state) => state.seeded);
  const rule = resolvePinnedOrderRule({ isWeb, seeded });

  return useMemo(() => {
    const selectionByKey = new Map<string, ActiveWorkspaceSelection>();
    const pinnedAtByKey: Record<string, string> = {};
    for (const { serverId, workspaceId, pinnedAt } of entries) {
      const key = `${serverId}:${workspaceId}`;
      selectionByKey.set(key, { serverId, workspaceId });
      pinnedAtByKey[key] = pinnedAt;
    }
    return orderPinnedWorkspaceKeys({ pinnedAtByKey, storedOrder, rule }).flatMap((key) => {
      const selection = selectionByKey.get(key);
      return selection ? [selection] : [];
    });
  }, [entries, storedOrder, rule]);
}
