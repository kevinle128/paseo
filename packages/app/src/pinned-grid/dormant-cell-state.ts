import {
  deriveAgentStateBucket,
  getWorkspaceStateBucketPriority,
  type AgentStateBucketInput,
  type WorkspaceStateBucket,
} from "@getpaseo/protocol/agent-state-bucket";

/** The light slice of an agent that a dormant cell reads. */
export interface DormantCellAgent extends AgentStateBucketInput {
  id: string;
  workspaceId?: string | null;
  archivedAt?: Date | null;
  /** True while a turn is open, which counts as running even when the status already moved on. */
  turnOpen?: boolean;
}

export interface DormantCellState {
  bucket: WorkspaceStateBucket;
  /** The agent that waits for the user, so a click can open its tab. Null unless `needs_input`. */
  attentionAgentId: string | null;
}

export const DONE_DORMANT_CELL_STATE: DormantCellState = { bucket: "done", attentionAgentId: null };

/**
 * The state a dormant cell shows: the most urgent state over every agent of the workspace, including
 * subagents, so a pending permission anywhere reads as `needs_input`.
 */
export function deriveDormantCellState(
  agents: Iterable<DormantCellAgent>,
  workspaceId: string,
): DormantCellState {
  let best: WorkspaceStateBucket = "done";
  let attentionAgentId: string | null = null;
  for (const agent of agents) {
    if (agent.archivedAt || agent.workspaceId !== workspaceId) {
      continue;
    }
    const bucket = deriveAgentStateBucket({
      status: agent.turnOpen ? "running" : agent.status,
      pendingPermissionCount: agent.pendingPermissionCount,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
      backgroundWork: agent.backgroundWork,
    });
    if (getWorkspaceStateBucketPriority(bucket) < getWorkspaceStateBucketPriority(best)) {
      best = bucket;
    }
    if (bucket === "needs_input" && attentionAgentId === null) {
      attentionAgentId = agent.id;
    }
  }
  return best === "done" && attentionAgentId === null
    ? DONE_DORMANT_CELL_STATE
    : { bucket: best, attentionAgentId };
}

export function areDormantCellStatesEqual(
  left: DormantCellState,
  right: DormantCellState,
): boolean {
  return left.bucket === right.bucket && left.attentionAgentId === right.attentionAgentId;
}

export interface DormantCellPlacement<Rect> {
  serverId: string;
  workspaceId: string;
  rect: Rect;
}

/**
 * The grid cells that need a card: those without a mounted workspace. The cards stay listed while
 * a cell is maximized; the deck hides them with the rest of the grid chrome.
 */
export function resolveDormantCells<Rect>(input: {
  cells: readonly { serverId: string; workspaceId: string }[] | null;
  mountedKeys: ReadonlySet<string>;
  cellRects: ReadonlyMap<string, Rect>;
}): DormantCellPlacement<Rect>[] {
  const { cells, mountedKeys, cellRects } = input;
  if (!cells) {
    return [];
  }
  const placements: DormantCellPlacement<Rect>[] = [];
  for (const cell of cells) {
    const key = `${cell.serverId}:${cell.workspaceId}`;
    const rect = cellRects.get(key);
    if (rect && !mountedKeys.has(key)) {
      placements.push({ serverId: cell.serverId, workspaceId: cell.workspaceId, rect });
    }
  }
  return placements;
}
