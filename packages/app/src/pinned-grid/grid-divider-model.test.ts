import { describe, expect, it } from "vitest";
import { computeResizeHandleSizes } from "@/components/resize-handle-sizes";
import { distributeRowHeights } from "./geometry";
import { ROW_DRAG_CONTAINER_SIZE, rowScalesFromDrag } from "./grid-divider-model";

function dragRow(input: { rowHeights: number[]; index: number; deltaPx: number }) {
  const draggedSizes = computeResizeHandleSizes({
    sizes: input.rowHeights,
    index: input.index,
    deltaRatio: input.deltaPx / ROW_DRAG_CONTAINER_SIZE,
  });
  return rowScalesFromDrag({
    rowHeights: input.rowHeights,
    index: input.index,
    draggedSizes,
    baseRowHeight: 300,
    minRowHeight: 120,
  });
}

describe("row divider model", () => {
  it("grows the row above the divider and shrinks the row below it", () => {
    expect(dragRow({ rowHeights: [300, 300], index: 0, deltaPx: 150 })).toEqual([1.5, 0.5]);
  });

  it("leaves rows away from the divider unchanged", () => {
    expect(dragRow({ rowHeights: [300, 300, 300], index: 1, deltaPx: -60 })).toEqual([
      1,
      240 / 300,
      360 / 300,
    ]);
  });

  it("clamps the dragged rows at the minimum height", () => {
    expect(dragRow({ rowHeights: [300, 300], index: 0, deltaPx: -1000 })).toEqual([
      120 / 300,
      480 / 300,
    ]);
  });

  it("produces weights that lay the rows out at the dragged heights", () => {
    const scales = dragRow({ rowHeights: [300, 300, 300], index: 0, deltaPx: 90 });
    expect(distributeRowHeights(3, 300, scales)).toEqual([390, 210, 300]);
  });
});
