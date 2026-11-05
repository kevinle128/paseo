import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import type { WorkspacePresence } from "./workspace-presence";

export const WORKSPACE_DECK_MAX_MOUNTED_WORKSPACES = 10;
/**
 * Pinned grid cells that stay mounted on web. Only `hidden` cells are evicted to reach it, so a
 * grid with more cells on screen mounts all of them.
 */
export const WORKSPACE_DECK_MAX_MOUNTED_GRID_CELLS = 12;
export const WORKSPACE_DECK_INACTIVE_TTL_MS = 10 * 60 * 1000;

export interface RetainedWorkspaceSelection {
  selection: ActiveWorkspaceSelection;
  inactiveSince: number | null;
}

export function resolveWorkspaceDeckRetentionLimit(input: { isNative: boolean }): number {
  return input.isNative ? 1 : WORKSPACE_DECK_MAX_MOUNTED_WORKSPACES;
}

/** What the cap needs to know about one grid cell, keyed by the workspace selection key. */
export interface GridCellRetentionState {
  presence: WorkspacePresence;
  /** Distance in px between the cell and the viewport; larger means further away. */
  distancePx: number;
}

interface ReconcileRetainedWorkspaceSelectionsInput {
  currentEntries: RetainedWorkspaceSelection[];
  activeSelection: ActiveWorkspaceSelection | null;
  now: number;
  maxMountedWorkspaces?: number;
  inactiveTtlMs?: number;
  /**
   * Workspaces the pinned grid shows right now. They stay mounted without a TTL and outside the
   * cap, and a pinned workspace the user never opened is added. Empty when no grid shows.
   */
  pinnedSelections?: ActiveWorkspaceSelection[];
  /**
   * Presence and distance of each grid cell. With it, pinned cells above
   * `maxMountedGridCells` lose their mount, `hidden` and farthest first. Without it every pinned
   * cell stays mounted.
   */
  gridCellStates?: ReadonlyMap<string, GridCellRetentionState>;
  maxMountedGridCells?: number;
}

interface GetNextWorkspaceDeckExpirationDelayInput {
  entries: RetainedWorkspaceSelection[];
  activeSelection: ActiveWorkspaceSelection | null;
  now: number;
  inactiveTtlMs?: number;
}

interface WorkspaceDeckEntryMountInput {
  isActive: boolean;
  hasHydratedWorkspaces: boolean;
  workspaceExists: boolean;
}

interface ResolveWorkspaceDeckEntriesInput {
  selections: ActiveWorkspaceSelection[];
  activeSelection: ActiveWorkspaceSelection | null;
}

export function getWorkspaceSelectionKey(selection: ActiveWorkspaceSelection): string {
  return `${selection.serverId}:${selection.workspaceId}`;
}

export function areWorkspaceSelectionsEqual(
  left: ActiveWorkspaceSelection | null,
  right: ActiveWorkspaceSelection | null,
): boolean {
  return left?.serverId === right?.serverId && left?.workspaceId === right?.workspaceId;
}

export function areRetainedWorkspaceSelectionListsEqual(
  left: RetainedWorkspaceSelection[],
  right: RetainedWorkspaceSelection[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) => {
    const otherEntry = right[index];
    return (
      otherEntry !== undefined &&
      entry.inactiveSince === otherEntry.inactiveSince &&
      areWorkspaceSelectionsEqual(entry.selection, otherEntry.selection)
    );
  });
}

/**
 * The grid cells that get a mounted workspace. Cells above the cap are dropped from the end of the
 * `hidden` cells, farthest from the viewport first. `focused` and `reduced` cells are never
 * dropped, and a cell with no state counts as on screen.
 */
export function resolveGridCellsToMount(input: {
  cells: ActiveWorkspaceSelection[];
  cellStates: ReadonlyMap<string, GridCellRetentionState>;
  maxMountedCells: number;
}): ActiveWorkspaceSelection[] {
  const { cells, cellStates, maxMountedCells } = input;
  const excess = cells.length - Math.max(0, maxMountedCells);
  if (excess <= 0) {
    return cells;
  }
  const evictable = cells
    .map((cell, index) => ({
      cell,
      index,
      state: cellStates.get(getWorkspaceSelectionKey(cell)),
    }))
    .filter((candidate) => candidate.state?.presence === "hidden")
    .sort(
      (left, right) =>
        (right.state?.distancePx ?? 0) - (left.state?.distancePx ?? 0) || right.index - left.index,
    )
    .slice(0, excess);
  if (evictable.length === 0) {
    return cells;
  }
  const evicted = new Set(evictable.map((candidate) => candidate.cell));
  return cells.filter((cell) => !evicted.has(cell));
}

export function reconcileRetainedWorkspaceSelections({
  currentEntries,
  activeSelection,
  now,
  maxMountedWorkspaces = WORKSPACE_DECK_MAX_MOUNTED_WORKSPACES,
  inactiveTtlMs = WORKSPACE_DECK_INACTIVE_TTL_MS,
  pinnedSelections: allPinnedSelections = [],
  gridCellStates,
  maxMountedGridCells = WORKSPACE_DECK_MAX_MOUNTED_GRID_CELLS,
}: ReconcileRetainedWorkspaceSelectionsInput): RetainedWorkspaceSelection[] {
  const pinnedSelections = gridCellStates
    ? resolveGridCellsToMount({
        cells: allPinnedSelections,
        cellStates: gridCellStates,
        maxMountedCells: maxMountedGridCells,
      })
    : allPinnedSelections;
  const pinnedKeys = new Set(allPinnedSelections.map(getWorkspaceSelectionKey));
  const isPinned = (selection: ActiveWorkspaceSelection) =>
    pinnedKeys.has(getWorkspaceSelectionKey(selection));
  // The cap limits growth and never shrinks a mounted set in one pass. When the grid closes, its
  // cells stay above the single-mode cap and leave only through the inactive TTL, so closing the
  // grid never remounts a workspace the user was just looking at.
  const cappedCurrentCount = currentEntries.filter((entry) => !isPinned(entry.selection)).length;
  const baseCap = activeSelection
    ? Math.max(1, maxMountedWorkspaces)
    : Math.max(0, maxMountedWorkspaces);
  const maxCappedSelections = Math.max(baseCap, cappedCurrentCount);
  const nextEntries: RetainedWorkspaceSelection[] = [];
  const seenSelectionKeys = new Set<string>();
  let cappedCount = 0;

  function appendEntry(entry: RetainedWorkspaceSelection): void {
    const selectionKey = getWorkspaceSelectionKey(entry.selection);
    if (seenSelectionKeys.has(selectionKey)) {
      return;
    }
    const countsTowardCap = !isPinned(entry.selection);
    if (countsTowardCap && cappedCount >= maxCappedSelections) {
      return;
    }
    seenSelectionKeys.add(selectionKey);
    if (countsTowardCap) {
      cappedCount += 1;
    }
    nextEntries.push(entry);
  }

  if (activeSelection) {
    appendEntry({ selection: activeSelection, inactiveSince: null });
  }

  for (const selection of pinnedSelections) {
    appendEntry({ selection, inactiveSince: null });
  }

  for (const entry of currentEntries) {
    if (
      areWorkspaceSelectionsEqual(entry.selection, activeSelection) ||
      isPinned(entry.selection)
    ) {
      continue;
    }
    const inactiveSince = entry.inactiveSince ?? now;
    if (now - inactiveSince >= inactiveTtlMs) {
      continue;
    }
    appendEntry({ selection: entry.selection, inactiveSince });
  }

  if (areRetainedWorkspaceSelectionListsEqual(currentEntries, nextEntries)) {
    return currentEntries;
  }
  return nextEntries;
}

export function getNextWorkspaceDeckExpirationDelay({
  entries,
  activeSelection,
  now,
  inactiveTtlMs = WORKSPACE_DECK_INACTIVE_TTL_MS,
}: GetNextWorkspaceDeckExpirationDelayInput): number | null {
  let nextExpirationDelay: number | null = null;

  for (const entry of entries) {
    if (
      areWorkspaceSelectionsEqual(entry.selection, activeSelection) ||
      entry.inactiveSince === null
    ) {
      continue;
    }
    const expirationDelay = Math.max(0, entry.inactiveSince + inactiveTtlMs - now);
    nextExpirationDelay =
      nextExpirationDelay === null
        ? expirationDelay
        : Math.min(nextExpirationDelay, expirationDelay);
  }

  return nextExpirationDelay;
}

export function orderWorkspaceSelectionsForStableRender(
  selections: ActiveWorkspaceSelection[],
): ActiveWorkspaceSelection[] {
  return [...selections].sort((left, right) =>
    getWorkspaceSelectionKey(left).localeCompare(getWorkspaceSelectionKey(right)),
  );
}

export function resolveWorkspaceDeckEntries({
  selections,
  activeSelection,
}: ResolveWorkspaceDeckEntriesInput): Array<{
  selection: ActiveWorkspaceSelection;
  active: boolean;
}> {
  return selections.map((selection) => ({
    selection,
    active: areWorkspaceSelectionsEqual(selection, activeSelection),
  }));
}

export function shouldKeepWorkspaceDeckEntryMounted({
  isActive,
  hasHydratedWorkspaces,
  workspaceExists,
}: WorkspaceDeckEntryMountInput): boolean {
  if (isActive) {
    return true;
  }
  if (!hasHydratedWorkspaces) {
    return true;
  }
  return workspaceExists;
}
