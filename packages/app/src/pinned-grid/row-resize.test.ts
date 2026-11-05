import { describe, expect, it } from "vitest";
import { resizeRow } from "./row-resize";

const base = { baseRowHeight: 300, minRowHeight: 120 };

describe("resizeRow", () => {
  it("converts the dragged height into a scale on the base row height", () => {
    const next = resizeRow({
      ...base,
      rowScales: [1, 1, 1],
      index: 1,
      startHeight: 300,
      deltaPx: 150,
    });
    expect(next).toEqual([1, 1.5, 1]);
  });

  it("clamps the row height at the minimum", () => {
    const next = resizeRow({
      ...base,
      rowScales: [1, 1],
      index: 0,
      startHeight: 300,
      deltaPx: -1000,
    });
    expect(next[0]).toBeCloseTo(120 / 300, 10);
    expect(next[1]).toBe(1);
  });

  it("leaves other rows unchanged and does not mutate the input", () => {
    const rowScales = [1, 2, 0.5];
    const next = resizeRow({ ...base, rowScales, index: 0, startHeight: 300, deltaPx: 30 });
    expect(next).toEqual([1.1, 2, 0.5]);
    expect(rowScales).toEqual([1, 2, 0.5]);
  });

  it("fills missing scales with 1 up to the resized row", () => {
    const next = resizeRow({ ...base, rowScales: [], index: 2, startHeight: 300, deltaPx: 300 });
    expect(next).toEqual([1, 1, 2]);
  });

  it("returns a copy when the base row height is not positive", () => {
    const rowScales = [1, 1];
    const next = resizeRow({
      ...base,
      baseRowHeight: 0,
      rowScales,
      index: 0,
      startHeight: 0,
      deltaPx: 10,
    });
    expect(next).toEqual([1, 1]);
    expect(next).not.toBe(rowScales);
  });

  it("returns a copy for a negative index", () => {
    expect(
      resizeRow({ ...base, rowScales: [1], index: -1, startHeight: 300, deltaPx: 10 }),
    ).toEqual([1]);
  });
});
