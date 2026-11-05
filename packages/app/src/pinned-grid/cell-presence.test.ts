import { describe, expect, it } from "vitest";
import type { WorkspacePresence } from "@/screens/workspace/workspace-presence";
import {
  CellPresenceTracker,
  distanceFromViewport,
  nextHiddenDeadline,
  resolveCellPresences,
  updateLastOnScreenAt,
} from "./cell-presence";
import type { GridCellRect } from "./geometry";

// Four rows of 300 px with 8 px gaps; the viewport shows the first two.
const rects: GridCellRect[] = [0, 1, 2, 3].map((row) => ({
  x: 0,
  y: row * 308,
  width: 400,
  height: 300,
}));
const base = {
  rects,
  scrollTop: 0,
  viewportHeight: 616,
  overscanPx: 0,
  focusedIndex: 0,
  maximizedIndex: null,
  now: 10_000,
  hiddenDelayMs: 2_000,
};
const NEVER = Number.NEGATIVE_INFINITY;

describe("resolveCellPresences", () => {
  it("makes exactly one cell focused and cells near the viewport reduced", () => {
    const presences = resolveCellPresences({
      ...base,
      lastOnScreenAt: [10_000, 10_000, NEVER, NEVER],
    });
    expect(presences).toEqual(["focused", "reduced", "hidden", "hidden"]);
  });

  it("keeps an off screen cell reduced until the delay passed", () => {
    const lastOnScreenAt = [10_000, 10_000, 9_000, NEVER];
    expect(resolveCellPresences({ ...base, lastOnScreenAt })[2]).toBe("reduced");
    expect(resolveCellPresences({ ...base, now: 11_000, lastOnScreenAt })[2]).toBe("hidden");
  });

  it("counts the overscan as near", () => {
    const presences = resolveCellPresences({
      ...base,
      overscanPx: 200,
      lastOnScreenAt: [10_000, 10_000, 10_000, NEVER],
    });
    expect(presences[2]).toBe("reduced");
    expect(presences[3]).toBe("hidden");
  });

  it("makes the other cells hidden while a cell is maximized", () => {
    const presences = resolveCellPresences({
      ...base,
      maximizedIndex: 1,
      lastOnScreenAt: [10_000, 10_000, 10_000, 10_000],
    });
    expect(presences).toEqual(["hidden", "focused", "hidden", "hidden"]);
  });

  it("keeps a focused cell focused when it is off screen", () => {
    const presences = resolveCellPresences({
      ...base,
      focusedIndex: 3,
      lastOnScreenAt: [10_000, 10_000, NEVER, NEVER],
    });
    expect(presences[3]).toBe("focused");
  });

  it("returns the previous array when nothing changed", () => {
    const lastOnScreenAt = [10_000, 10_000, NEVER, NEVER];
    const first = resolveCellPresences({ ...base, lastOnScreenAt });
    const second = resolveCellPresences({ ...base, now: 10_050, lastOnScreenAt, previous: first });
    expect(second).toBe(first);
    const changed: WorkspacePresence[] = resolveCellPresences({
      ...base,
      lastOnScreenAt,
      focusedIndex: 1,
      previous: first,
    });
    expect(changed).not.toBe(first);
    expect(changed).toEqual(["reduced", "focused", "hidden", "hidden"]);
  });
});

describe("updateLastOnScreenAt", () => {
  const view = { scrollTop: 0, viewportHeight: 616, overscanPx: 0 };

  it("stamps near cells and leaves the others", () => {
    const next = updateLastOnScreenAt({
      rects,
      view,
      now: 5,
      previous: [1, 2, 3, NEVER],
    });
    expect(next).toEqual([5, 5, 3, NEVER]);
  });

  it("returns the previous array when no stamp moved", () => {
    const previous = [NEVER, NEVER, NEVER, NEVER];
    const next = updateLastOnScreenAt({
      rects,
      view: { scrollTop: 5_000, viewportHeight: 616, overscanPx: 0 },
      now: 5,
      previous,
    });
    expect(next).toBe(previous);
  });
});

describe("nextHiddenDeadline", () => {
  it("returns the earliest time an off screen reduced cell turns hidden", () => {
    const lastOnScreenAt = [10_000, 10_000, 9_000, 9_500];
    const presences = resolveCellPresences({ ...base, lastOnScreenAt });
    expect(nextHiddenDeadline({ ...base, presences, lastOnScreenAt })).toBe(11_000);
  });

  it("returns null when no cell waits", () => {
    const lastOnScreenAt = [10_000, 10_000, NEVER, NEVER];
    const presences = resolveCellPresences({ ...base, lastOnScreenAt });
    expect(nextHiddenDeadline({ ...base, presences, lastOnScreenAt })).toBeNull();
  });
});

describe("distanceFromViewport", () => {
  const view = { scrollTop: 0, viewportHeight: 616, overscanPx: 0 };
  it("is zero when the cell meets the viewport", () => {
    expect(distanceFromViewport(rects[1], view)).toBe(0);
  });
  it("measures below and above the viewport", () => {
    expect(distanceFromViewport(rects[3], view)).toBe(924 - 616);
    expect(distanceFromViewport(rects[0], { ...view, scrollTop: 1_000 })).toBe(1_000 - 300);
  });
});

describe("CellPresenceTracker", () => {
  const input = {
    rects,
    scrollTop: 0,
    viewportHeight: 616,
    focusedIndex: 0,
    maximizedIndex: null,
    now: 1_000,
  };
  const tracker = () => new CellPresenceTracker({ hiddenDelayMs: 2_000, overscanRatio: 0 });

  it("starts a cell that was never on screen as hidden", () => {
    expect(tracker().evaluate(input).presences).toEqual(["focused", "reduced", "hidden", "hidden"]);
  });

  it("keeps a scrolled-away cell reduced for the delay, then hides it", () => {
    const t = tracker();
    t.evaluate(input);
    const scrolled = { ...input, scrollTop: 924, now: 2_000 };
    const first = t.evaluate(scrolled);
    expect(first.presences).toEqual(["focused", "reduced", "hidden", "reduced"]);
    expect(first.deadline).toBe(3_000);
    const later = t.evaluate({ ...scrolled, now: 3_000 });
    expect(later.presences).toEqual(["focused", "hidden", "hidden", "reduced"]);
  });

  it("returns the same snapshot for the same inputs", () => {
    const t = tracker();
    const first = t.evaluate(input);
    expect(t.evaluate({ ...input, now: 1_010 })).toBe(first);
  });

  it("turns a cell reduced at once when it scrolls into view", () => {
    const t = tracker();
    t.evaluate(input);
    const scrolled = t.evaluate({ ...input, scrollTop: 616, now: 5_000 });
    expect(scrolled.presences[2]).toBe("reduced");
    expect(scrolled.presences[3]).toBe("reduced");
  });

  it("resets its memory when the number of cells changes", () => {
    const t = tracker();
    t.evaluate(input);
    const fewer = t.evaluate({ ...input, rects: rects.slice(0, 2) });
    expect(fewer.presences).toEqual(["focused", "reduced"]);
  });

  it("does not record what a preview saw", () => {
    const t = tracker();
    t.evaluate(input);
    const scrolled = { ...input, scrollTop: 924, now: 2_000 };

    t.preview(scrolled);
    // Had the preview recorded cell 3 as on screen at 2 000, it would still be reduced here.
    const later = t.evaluate({ ...scrolled, scrollTop: 0, now: 5_000 });

    expect(later.presences[3]).toBe("hidden");
  });

  it("previews the snapshot an evaluation of the same input returns", () => {
    const t = tracker();
    const previewed = t.preview(input);

    expect(t.evaluate(input)).toEqual(previewed);
  });
});
