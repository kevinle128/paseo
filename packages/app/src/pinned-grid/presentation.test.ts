import { describe, expect, it } from "vitest";
import { resolveDeckPresentation } from "./presentation";
import type { PinnedGridMode } from "./preferences";

const a = { serverId: "s1", workspaceId: "a" };
const b = { serverId: "s2", workspaceId: "b" };
const c = { serverId: "s1", workspaceId: "c" };
const pinned = [a, b, c];

function resolve(overrides: Partial<Parameters<typeof resolveDeckPresentation>[0]> = {}) {
  return resolveDeckPresentation({
    mode: "2",
    supportsGrid: true,
    focusModeEnabled: false,
    activeSelection: b,
    pinnedSelections: pinned,
    ...overrides,
  });
}

describe("resolveDeckPresentation", () => {
  it("is single in normal mode", () => {
    expect(resolve({ mode: "normal" })).toEqual({ kind: "single" });
  });

  it("is single where the platform cannot host a grid", () => {
    expect(resolve({ supportsGrid: false })).toEqual({ kind: "single" });
  });

  it("is single without an active selection", () => {
    expect(resolve({ activeSelection: null })).toEqual({ kind: "single" });
  });

  it("is single when the active workspace is not pinned", () => {
    expect(resolve({ activeSelection: { serverId: "s1", workspaceId: "other" } })).toEqual({
      kind: "single",
    });
  });

  it("matches the active workspace on host as well as id", () => {
    expect(resolve({ activeSelection: { serverId: "s2", workspaceId: "a" } })).toEqual({
      kind: "single",
    });
  });

  it("is single while focus mode is on, and a grid again once it is off", () => {
    expect(resolve({ focusModeEnabled: true })).toEqual({ kind: "single" });
    expect(resolve({ focusModeEnabled: false }).kind).toBe("grid");
  });

  it.each<[PinnedGridMode, 2 | 3]>([
    ["2", 2],
    ["3", 3],
  ])(
    "is a grid with %s columns, cells in order, focused on the active workspace",
    (mode, columns) => {
      expect(resolve({ mode })).toEqual({ kind: "grid", columns, cells: pinned, focused: b });
    },
  );
});
