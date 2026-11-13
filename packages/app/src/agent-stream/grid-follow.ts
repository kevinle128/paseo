import type { WorkspaceGridCell } from "@/pinned-grid/grid-cell-context";

/**
 * A grid cell that does not own input always follows its newest message and shows no
 * scroll-to-bottom button. The focused cell and Normal mode (no cell) keep the reader's scroll.
 */
export function isUnfocusedGridCell(cell: Pick<WorkspaceGridCell, "isFocused"> | null): boolean {
  return cell !== null && !cell.isFocused;
}
