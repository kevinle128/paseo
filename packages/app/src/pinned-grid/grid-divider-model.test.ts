import { describe, expect, it } from "vitest";
import { computeResizeHandleSizes } from "@/components/resize-handle-sizes";
import {
  ROW_DRAG_CONTAINER_SIZE,
  ROW_DRAG_SPAN,
  rowDragSizes,
  rowScalesFromDrag,
} from "./grid-divider-model";

function dragRow(input: { rowHeight: number; deltaPx: number; rowScales: number[] }) {
  const sizes = rowDragSizes(input.rowHeight);
  const draggedSizes = computeResizeHandleSizes({
    sizes,
    index: 0,
    deltaRatio: input.deltaPx / ROW_DRAG_CONTAINER_SIZE,
  });
  return rowScalesFromDrag({
    rowScales: input.rowScales,
    index: 0,
    startHeight: input.rowHeight,
    draggedSizes,
    baseRowHeight: 300,
    minRowHeight: 120,
  });
}

describe("row divider model", () => {
  it("grows only the dragged row in pixels", () => {
    expect(dragRow({ rowHeight: 300, deltaPx: 150, rowScales: [] })).toEqual([1.5]);
  });

  it("keeps the other row scales", () => {
    expect(dragRow({ rowHeight: 300, deltaPx: 60, rowScales: [1, 2, 0.8] })).toEqual([1.2, 2, 0.8]);
  });

  it("clamps the row at the minimum height", () => {
    expect(dragRow({ rowHeight: 300, deltaPx: -1000, rowScales: [] })).toEqual([120 / 300]);
  });

  it("keeps the virtual pair sum constant", () => {
    const next = computeResizeHandleSizes({
      sizes: rowDragSizes(300),
      index: 0,
      deltaRatio: 40,
    });
    expect((next[0] ?? 0) + (next[1] ?? 0)).toBe(300 + ROW_DRAG_SPAN);
  });
});
