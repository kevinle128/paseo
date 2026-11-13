import { describe, expect, it } from "vitest";
import { resizeRowPair } from "./row-resize";

const base = { baseRowHeight: 300, minRowHeight: 120 };

describe("resizeRowPair", () => {
  it("moves height between the two rows at the divider and keeps their sum", () => {
    const next = resizeRowPair({ ...base, rowHeights: [300, 300, 300], index: 0, nextHeight: 400 });
    expect(next).toEqual([400 / 300, 200 / 300, 1]);
  });

  it("keeps the total height of every row", () => {
    const rowHeights = [300, 450, 150];
    const next = resizeRowPair({ ...base, rowHeights, index: 1, nextHeight: 500 });
    const total = next.reduce((sum, weight) => sum + weight * 300, 0);
    expect(total).toBeCloseTo(900, 10);
    expect(rowHeights).toEqual([300, 450, 150]);
  });

  it("clamps each row of the pair at the minimum height", () => {
    expect(resizeRowPair({ ...base, rowHeights: [300, 300], index: 0, nextHeight: 10 })).toEqual([
      120 / 300,
      480 / 300,
    ]);
    expect(resizeRowPair({ ...base, rowHeights: [300, 300], index: 0, nextHeight: 590 })).toEqual([
      480 / 300,
      120 / 300,
    ]);
  });

  it("splits a pair smaller than two minimums evenly at most", () => {
    const next = resizeRowPair({ ...base, rowHeights: [100, 100], index: 0, nextHeight: 0 });
    expect(next).toEqual([100 / 300, 100 / 300]);
  });

  it("returns the current weights for a divider without a row below it", () => {
    expect(resizeRowPair({ ...base, rowHeights: [300, 600], index: 1, nextHeight: 10 })).toEqual([
      1, 2,
    ]);
    expect(resizeRowPair({ ...base, rowHeights: [300], index: -1, nextHeight: 10 })).toEqual([1]);
  });

  it("returns equal weights when the base row height is not positive", () => {
    expect(
      resizeRowPair({ ...base, baseRowHeight: 0, rowHeights: [0, 0], index: 0, nextHeight: 0 }),
    ).toEqual([1, 1]);
  });
});
