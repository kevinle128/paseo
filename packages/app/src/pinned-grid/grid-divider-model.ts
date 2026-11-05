import { resizeRow } from "./row-resize";

/**
 * `ResizeHandle` resizes a pair of neighbours in ratio units. A row divider changes one row's
 * height in pixels, so the handle gets a two-slot virtual pair `[rowHeight, ROW_DRAG_SPAN]`
 * and a container size of 1. The first slot of the result is then the dragged row's new height,
 * and the rows below shift instead of shrinking.
 */
export const ROW_DRAG_SPAN = 1_000_000;
export const ROW_DRAG_CONTAINER_SIZE = 1;

export function rowDragSizes(rowHeight: number): number[] {
  return [rowHeight, ROW_DRAG_SPAN];
}

export function rowScalesFromDrag(input: {
  rowScales: number[];
  index: number;
  startHeight: number;
  draggedSizes: number[];
  baseRowHeight: number;
  minRowHeight: number;
}): number[] {
  const nextHeight = input.draggedSizes[0] ?? input.startHeight;
  return resizeRow({
    rowScales: input.rowScales,
    index: input.index,
    startHeight: input.startHeight,
    deltaPx: nextHeight - input.startHeight,
    baseRowHeight: input.baseRowHeight,
    minRowHeight: input.minRowHeight,
  });
}
