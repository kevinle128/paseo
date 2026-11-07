import { describe, expect, it } from "vitest";
import {
  resolveCellChromeCorners,
  resolveGridCellPresence,
  resolveGridFocusedKey,
  resolveGridSlots,
  resolveScrollToCell,
} from "./grid-layout";

describe("resolveGridFocusedKey", () => {
  const cellKeys = ["s:a", "s:b", "s:c"];

  it("prefers the local focus that changed on the click", () => {
    expect(resolveGridFocusedKey({ localFocusedKey: "s:b", routeKey: "s:a", cellKeys })).toBe(
      "s:b",
    );
  });

  it("falls back to the route when nothing is focused locally", () => {
    expect(resolveGridFocusedKey({ localFocusedKey: null, routeKey: "s:c", cellKeys })).toBe("s:c");
  });

  it("falls back to the route when the local focus left the grid", () => {
    expect(resolveGridFocusedKey({ localFocusedKey: "s:gone", routeKey: "s:a", cellKeys })).toBe(
      "s:a",
    );
  });

  it("returns null when neither key is a cell", () => {
    expect(resolveGridFocusedKey({ localFocusedKey: null, routeKey: "s:x", cellKeys })).toBeNull();
  });
});

describe("resolveGridCellPresence", () => {
  it("makes the focused cell focused and the other cells reduced", () => {
    const base = { focusedKey: "s:a", maximizedKey: null };
    expect(resolveGridCellPresence({ ...base, key: "s:a", isCell: true })).toBe("focused");
    expect(resolveGridCellPresence({ ...base, key: "s:b", isCell: true })).toBe("reduced");
  });

  it("hides entries that are not grid cells", () => {
    expect(
      resolveGridCellPresence({ key: "s:u", isCell: false, focusedKey: "s:a", maximizedKey: null }),
    ).toBe("hidden");
  });

  it("keeps the maximized cell focused and hides every other cell", () => {
    const base = { focusedKey: "s:a", maximizedKey: "s:a" };
    expect(resolveGridCellPresence({ ...base, key: "s:a", isCell: true })).toBe("focused");
    expect(resolveGridCellPresence({ ...base, key: "s:b", isCell: true })).toBe("hidden");
  });
});

describe("resolveScrollToCell", () => {
  const view = { scrollTop: 100, viewportHeight: 600 };

  it("does not scroll when the cell is fully visible", () => {
    expect(resolveScrollToCell({ ...view, cellTop: 120, cellHeight: 300 })).toBeNull();
  });

  it("scrolls up to the cell top when the cell is above the viewport", () => {
    expect(resolveScrollToCell({ ...view, cellTop: 0, cellHeight: 300 })).toBe(0);
  });

  it("scrolls down just far enough to show the cell bottom", () => {
    expect(resolveScrollToCell({ ...view, cellTop: 600, cellHeight: 300 })).toBe(300);
  });

  it("aligns the cell top when the cell is taller than the viewport", () => {
    expect(resolveScrollToCell({ ...view, cellTop: 700, cellHeight: 800 })).toBe(700);
  });
});

describe("resolveCellChromeCorners", () => {
  it("gives the first row the window corners it touches", () => {
    expect(resolveCellChromeCorners({ index: 0, columns: 3, isMaximized: false })).toBe("top-left");
    expect(resolveCellChromeCorners({ index: 1, columns: 3, isMaximized: false })).toBe("none");
    expect(resolveCellChromeCorners({ index: 2, columns: 3, isMaximized: false })).toBe(
      "top-right",
    );
  });

  it("gives lower rows no corners", () => {
    expect(resolveCellChromeCorners({ index: 3, columns: 3, isMaximized: false })).toBe("none");
  });

  it("gives a maximized cell both corners", () => {
    expect(resolveCellChromeCorners({ index: 4, columns: 2, isMaximized: true })).toBe("both");
  });
});

describe("resolveGridSlots", () => {
  const cellKeys = ["s:a", "s:b", "s:c"];

  it("uses committed indices and no drop slot without a preview", () => {
    const slots = resolveGridSlots({ cellKeys, previewOrder: null });
    expect([...slots.slotIndexByKey]).toEqual([
      ["s:a", 0],
      ["s:b", 1],
      ["s:c", 2],
    ]);
    expect(slots.dropSlotIndex).toBeNull();
  });

  it("shifts the other cells and reports the dragged cell's slot", () => {
    const slots = resolveGridSlots({
      cellKeys,
      previewOrder: ["s:b", "s:c", "s:a"],
      draggedKey: "s:a",
    });
    expect(slots.slotIndexByKey.get("s:a")).toBe(2);
    expect(slots.slotIndexByKey.get("s:b")).toBe(0);
    expect(slots.slotIndexByKey.get("s:c")).toBe(1);
    expect(slots.dropSlotIndex).toBe(2);
  });

  it("points the drop slot at the committed slot before the first move", () => {
    const slots = resolveGridSlots({ cellKeys, previewOrder: null, draggedKey: "s:b" });
    expect(slots.dropSlotIndex).toBe(1);
  });

  it("keeps the committed index of a key the preview does not name", () => {
    const slots = resolveGridSlots({
      cellKeys,
      previewOrder: ["s:b", "s:a"],
      draggedKey: "s:a",
    });
    expect(slots.slotIndexByKey.get("s:c")).toBe(2);
    expect(slots.slotIndexByKey.get("s:b")).toBe(0);
    expect(slots.slotIndexByKey.get("s:a")).toBe(1);
  });
});
