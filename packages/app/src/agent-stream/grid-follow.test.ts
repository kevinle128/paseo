import { describe, expect, it } from "vitest";
import { isUnfocusedGridCell } from "./grid-follow";

describe("isUnfocusedGridCell", () => {
  it("is false outside a grid", () => {
    expect(isUnfocusedGridCell(null)).toBe(false);
  });

  it("is false for the focused cell", () => {
    expect(isUnfocusedGridCell({ isFocused: true })).toBe(false);
  });

  it("is true for a cell that is not focused", () => {
    expect(isUnfocusedGridCell({ isFocused: false })).toBe(true);
  });
});
