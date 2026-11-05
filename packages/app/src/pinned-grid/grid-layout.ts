import type { WorkspacePresence } from "@/screens/workspace/workspace-presence";

/** A row never shrinks below this height when the user drags a row divider. */
export const MIN_GRID_ROW_HEIGHT = 120;

/**
 * The cell that owns input. Local focus wins because it changes in the same commit as the click,
 * while the route follows afterwards. A local key that is no longer a cell falls back to the route.
 */
export function resolveGridFocusedKey(input: {
  localFocusedKey: string | null;
  routeKey: string | null;
  cellKeys: readonly string[];
}): string | null {
  const { localFocusedKey, routeKey, cellKeys } = input;
  if (localFocusedKey !== null && cellKeys.includes(localFocusedKey)) {
    return localFocusedKey;
  }
  return routeKey !== null && cellKeys.includes(routeKey) ? routeKey : null;
}

/**
 * Presence of one deck entry while the grid shows. Every visible cell that does not own input is
 * `reduced`; a maximized cell covers the others, which stay mounted as `hidden`.
 */
export function resolveGridCellPresence(input: {
  key: string;
  isCell: boolean;
  focusedKey: string | null;
  maximizedKey: string | null;
}): WorkspacePresence {
  const { key, isCell, focusedKey, maximizedKey } = input;
  if (!isCell) {
    return "hidden";
  }
  if (maximizedKey !== null) {
    return key === maximizedKey ? "focused" : "hidden";
  }
  return key === focusedKey ? "focused" : "reduced";
}

/**
 * The scroll offset that brings a cell into view, or null when it is already fully visible.
 * Used when focus moves to a cell from outside the grid, such as a sidebar click.
 */
export function resolveScrollToCell(input: {
  cellTop: number;
  cellHeight: number;
  scrollTop: number;
  viewportHeight: number;
}): number | null {
  const { cellTop, cellHeight, scrollTop, viewportHeight } = input;
  const cellBottom = cellTop + cellHeight;
  if (cellTop >= scrollTop && cellBottom <= scrollTop + viewportHeight) {
    return null;
  }
  if (cellHeight >= viewportHeight || cellTop < scrollTop) {
    return Math.max(0, cellTop);
  }
  return Math.max(0, cellBottom - viewportHeight);
}

export type GridChromeCorners = "both" | "top-left" | "top-right" | "none";

/**
 * Which window corners a cell touches, so only the first row reserves room for the window
 * controls. A maximized cell covers the whole area and owns both corners.
 */
export function resolveCellChromeCorners(input: {
  index: number;
  columns: number;
  isMaximized: boolean;
}): GridChromeCorners {
  if (input.isMaximized) {
    return "both";
  }
  const row = Math.floor(input.index / input.columns);
  const column = input.index % input.columns;
  const topLeft = row === 0 && column === 0;
  const topRight = row === 0 && column === input.columns - 1;
  if (topLeft && topRight) {
    return "both";
  }
  if (topLeft) {
    return "top-left";
  }
  return topRight ? "top-right" : "none";
}
