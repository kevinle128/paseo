import { describe, expect, it } from "vitest";
import {
  AUTO_SCROLL_EDGE_PX,
  AUTO_SCROLL_MAX_STEP_PX,
  hasCrossedDragThreshold,
  moveKey,
  rebasePreview,
  resolveAutoScrollStep,
  resolveDropIndex,
  shouldCancelDragOnInterrupt,
} from "./grid-reorder";

describe("hasCrossedDragThreshold", () => {
  it("needs 6 px of distance", () => {
    expect(hasCrossedDragThreshold(5, 0)).toBe(false);
    expect(hasCrossedDragThreshold(6, 0)).toBe(true);
    expect(hasCrossedDragThreshold(4, 5)).toBe(true);
    expect(hasCrossedDragThreshold(-6, 0)).toBe(true);
  });
});

describe("resolveDropIndex", () => {
  const rects = [
    { x: 0, y: 0, width: 100, height: 100 },
    { x: 108, y: 0, width: 100, height: 100 },
    { x: 0, y: 108, width: 100, height: 100 },
    { x: 108, y: 108, width: 100, height: 100 },
  ];
  const slotRect = (index: number) => rects[index];

  it("returns the slot under the point", () => {
    expect(
      resolveDropIndex({ point: { x: 150, y: 50 }, slotRect, cellCount: 3, currentIndex: 0 }),
    ).toBe(1);
  });

  it("maps the add slot to the last cell", () => {
    expect(
      resolveDropIndex({ point: { x: 150, y: 150 }, slotRect, cellCount: 3, currentIndex: 0 }),
    ).toBe(2);
  });

  it("keeps the current index in a gap", () => {
    expect(
      resolveDropIndex({ point: { x: 104, y: 50 }, slotRect, cellCount: 3, currentIndex: 2 }),
    ).toBe(2);
  });
});

describe("moveKey", () => {
  it("moves a key to the target index", () => {
    expect(moveKey(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
    expect(moveKey(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
  });

  it("returns the same array when nothing moves", () => {
    const keys = ["a", "b", "c"];
    expect(moveKey(keys, "b", 1)).toBe(keys);
    expect(moveKey(keys, "missing", 0)).toBe(keys);
  });
});

describe("resolveAutoScrollStep", () => {
  const viewport = { viewportTop: 100, viewportBottom: 700 };

  it("is 0 away from the edges", () => {
    expect(resolveAutoScrollStep({ pointerY: 400, ...viewport })).toBe(0);
  });

  it("is negative near the top and positive near the bottom", () => {
    expect(
      resolveAutoScrollStep({ pointerY: 100 + AUTO_SCROLL_EDGE_PX / 2, ...viewport }),
    ).toBeLessThan(0);
    expect(
      resolveAutoScrollStep({ pointerY: 700 - AUTO_SCROLL_EDGE_PX / 2, ...viewport }),
    ).toBeGreaterThan(0);
  });

  it("is bounded and grows with depth", () => {
    const shallow = resolveAutoScrollStep({ pointerY: 700 - 40, ...viewport });
    const deep = resolveAutoScrollStep({ pointerY: 700 - 4, ...viewport });
    expect(deep).toBeGreaterThan(shallow);
    expect(resolveAutoScrollStep({ pointerY: 5000, ...viewport })).toBe(AUTO_SCROLL_MAX_STEP_PX);
    expect(resolveAutoScrollStep({ pointerY: -5000, ...viewport })).toBe(-AUTO_SCROLL_MAX_STEP_PX);
  });
});

describe("rebasePreview", () => {
  it("drops removed keys and appends new ones", () => {
    expect(rebasePreview({ preview: ["b", "a", "x"], cellKeys: ["a", "b", "c"] })).toEqual([
      "b",
      "a",
      "c",
    ]);
  });
});

describe("shouldCancelDragOnInterrupt", () => {
  it("is true only while a key is dragged", () => {
    expect(shouldCancelDragOnInterrupt("a")).toBe(true);
    expect(shouldCancelDragOnInterrupt(null)).toBe(false);
  });
});
