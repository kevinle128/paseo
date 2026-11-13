import { resizeRowPair } from "./row-resize";

/**
 * Row dividers use the same `ResizeHandle` as column dividers, with the row heights in pixels as
 * the sizes and a container size of 1, so a drag delta arrives in pixels. The handle moves height
 * between the two rows next to the divider and keeps their sum.
 */
export const ROW_DRAG_CONTAINER_SIZE = 1;

/** Row weights after a drag: the two rows at the divider take the dragged split, the rest keep theirs. */
export function rowScalesFromDrag(input: {
  rowHeights: number[];
  index: number;
  draggedSizes: number[];
  baseRowHeight: number;
  minRowHeight: number;
}): number[] {
  const { rowHeights, index, draggedSizes, baseRowHeight, minRowHeight } = input;
  return resizeRowPair({
    rowHeights,
    index,
    nextHeight: draggedSizes[index] ?? rowHeights[index] ?? 0,
    baseRowHeight,
    minRowHeight,
  });
}
