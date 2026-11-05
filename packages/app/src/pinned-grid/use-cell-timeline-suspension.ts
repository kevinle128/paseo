import { useLayoutEffect } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore } from "@/stores/session-store";
import { collectAllTabs } from "@/stores/workspace-layout-actions";
import {
  useWorkspaceLayoutStore,
  type WorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

const NO_AGENT_IDS: string[] = [];

function areIdListsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * The chats a workspace has open, from its pane layout and its sheet tabs, sorted. A chat open only
 * in a sheet still streams, so it must be part of what a hidden cell releases.
 */
export function selectCellAgentIds(
  state: Pick<WorkspaceLayoutStore, "layoutByWorkspace" | "sheetsByWorkspace">,
  sourceId: string | null,
): string[] {
  if (!sourceId) {
    return NO_AGENT_IDS;
  }
  const ids = new Set<string>();
  const layout = state.layoutByWorkspace[sourceId];
  if (layout) {
    for (const tab of collectAllTabs(layout.root)) {
      if (tab.target.kind === "agent") {
        ids.add(tab.target.agentId);
      }
    }
  }
  for (const sheet of state.sheetsByWorkspace[sourceId] ?? []) {
    if (sheet.tab.target.kind === "agent") {
      ids.add(sheet.tab.target.agentId);
    }
  }
  return ids.size === 0 ? NO_AGENT_IDS : [...ids].sort();
}

/**
 * While a grid cell is hidden, its chats leave the timeline subscription and the daemon stops
 * streaming them. Showing the cell again returns them through the regular catch-up. The cell
 * stays suspended if it unmounts while hidden, because its dormant card needs no stream;
 * `useReleaseUnmountedCellSuspensions` ends that when the cell leaves the grid.
 */
export function useCellTimelineSuspension(input: {
  serverId: string;
  workspaceId: string;
  suspended: boolean;
}): void {
  const { serverId, workspaceId, suspended } = input;
  const sourceId = buildWorkspaceTabPersistenceKey({ serverId, workspaceId });
  const viewedTimelineSync = useSessionStore(
    (state) => state.sessions[serverId]?.viewedTimelineSync ?? null,
  );
  const agentIds = useStoreWithEqualityFn(
    useWorkspaceLayoutStore,
    (state) => selectCellAgentIds(state, sourceId),
    areIdListsEqual,
  );

  useLayoutEffect(() => {
    if (!sourceId || !viewedTimelineSync) {
      return;
    }
    if (suspended) {
      viewedTimelineSync.suspendSource(sourceId, agentIds);
    } else {
      viewedTimelineSync.resumeSource(sourceId);
    }
  }, [agentIds, sourceId, suspended, viewedTimelineSync]);
}
