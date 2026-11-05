import { describe, expect, it } from "vitest";
import { INITIAL_GRID_FOCUS, reduceGridFocus } from "./grid-focus";

describe("reduceGridFocus", () => {
  it("focuses the cell on pointer-down at once", () => {
    expect(reduceGridFocus(INITIAL_GRID_FOCUS, { type: "pointer-down", key: "s1:a" })).toEqual({
      focusedKey: "s1:a",
    });
  });

  it("follows a route change such as a sidebar click", () => {
    expect(reduceGridFocus({ focusedKey: "s1:a" }, { type: "route-changed", key: "s1:c" })).toEqual(
      { focusedKey: "s1:c" },
    );
  });

  it("returns the same state when the key is already focused", () => {
    const state = { focusedKey: "s1:a" };
    expect(reduceGridFocus(state, { type: "pointer-down", key: "s1:a" })).toBe(state);
    expect(reduceGridFocus(state, { type: "route-changed", key: "s1:a" })).toBe(state);
  });

  it("keeps focus while the focused cell is still a cell", () => {
    const state = { focusedKey: "s1:a" };
    expect(reduceGridFocus(state, { type: "cells-changed", keys: ["s1:a", "s1:b"] })).toBe(state);
  });

  it("clears focus when the focused cell leaves the grid", () => {
    expect(
      reduceGridFocus({ focusedKey: "s1:a" }, { type: "cells-changed", keys: ["s1:b"] }),
    ).toEqual({ focusedKey: null });
  });

  it("ignores cell changes when nothing is focused", () => {
    expect(reduceGridFocus(INITIAL_GRID_FOCUS, { type: "cells-changed", keys: [] })).toBe(
      INITIAL_GRID_FOCUS,
    );
  });
});
