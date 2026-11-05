import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";

function isSameSelection(a: ActiveWorkspaceSelection, b: ActiveWorkspaceSelection): boolean {
  return a.serverId === b.serverId && a.workspaceId === b.workspaceId;
}

/**
 * Where focus goes when the focused cell leaves the grid: the nearest remaining cell after it in
 * the previous order, or the nearest one before it when it was last. Returns null when the active
 * workspace was not a cell, is still a cell, or no cell remains. The result is an element of
 * `nextCells`.
 */
export function resolveFocusAfterCellRemoval(input: {
  previousCells: readonly ActiveWorkspaceSelection[];
  nextCells: readonly ActiveWorkspaceSelection[];
  activeSelection: ActiveWorkspaceSelection | null;
}): ActiveWorkspaceSelection | null {
  const { previousCells, nextCells, activeSelection } = input;
  if (!activeSelection || nextCells.some((cell) => isSameSelection(cell, activeSelection))) {
    return null;
  }
  const activeIndex = previousCells.findIndex((cell) => isSameSelection(cell, activeSelection));
  if (activeIndex === -1) {
    return null;
  }
  const remaining = (cell: ActiveWorkspaceSelection) =>
    nextCells.find((candidate) => isSameSelection(candidate, cell)) ?? null;
  for (let index = activeIndex + 1; index < previousCells.length; index += 1) {
    const found = remaining(previousCells[index]);
    if (found) {
      return found;
    }
  }
  for (let index = activeIndex - 1; index >= 0; index -= 1) {
    const found = remaining(previousCells[index]);
    if (found) {
      return found;
    }
  }
  return null;
}
