import { describe, expect, it } from "vitest";
import { INITIAL_MAXIMIZE_STATE, reduceMaximize } from "./maximize-state";

describe("reduceMaximize", () => {
  it("maximizes a cell on toggle", () => {
    expect(reduceMaximize(INITIAL_MAXIMIZE_STATE, { type: "toggle", key: "s:a" })).toEqual({
      maximizedKey: "s:a",
    });
  });

  it("restores the grid when the maximized cell toggles again", () => {
    expect(reduceMaximize({ maximizedKey: "s:a" }, { type: "toggle", key: "s:a" })).toEqual({
      maximizedKey: null,
    });
  });

  it("switches the maximized cell when another cell toggles", () => {
    expect(reduceMaximize({ maximizedKey: "s:a" }, { type: "toggle", key: "s:b" })).toEqual({
      maximizedKey: "s:b",
    });
  });

  it("restores the grid when the route moves to another cell", () => {
    expect(reduceMaximize({ maximizedKey: "s:a" }, { type: "route-changed", key: "s:b" })).toEqual({
      maximizedKey: null,
    });
  });

  it("keeps the maximized cell when the route points at it", () => {
    const state = { maximizedKey: "s:a" };
    expect(reduceMaximize(state, { type: "route-changed", key: "s:a" })).toBe(state);
  });

  it("restores the grid when the maximized cell is unpinned", () => {
    expect(
      reduceMaximize({ maximizedKey: "s:a" }, { type: "cells-changed", keys: ["s:b"] }),
    ).toEqual({ maximizedKey: null });
  });

  it("keeps the maximized cell while it stays pinned", () => {
    const state = { maximizedKey: "s:a" };
    expect(reduceMaximize(state, { type: "cells-changed", keys: ["s:a", "s:b"] })).toBe(state);
  });
});
