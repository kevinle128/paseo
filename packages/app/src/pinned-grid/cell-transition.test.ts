import { describe, expect, it } from "vitest";
import {
  buildFadeKeyframes,
  buildMaximizeKeyframes,
  buildRestoreKeyframes,
  formatClipInset,
  resolveClipInsets,
} from "./cell-transition";

const full = { x: 0, y: 0, width: 1000, height: 600 };
const slot = { x: 508, y: 308, width: 492, height: 292 };

describe("resolveClipInsets", () => {
  it("measures each side of the inner rect inside the outer rect", () => {
    expect(resolveClipInsets(full, slot)).toEqual({ top: 308, right: 0, bottom: 0, left: 508 });
  });

  it("gives zero for equal rects", () => {
    expect(resolveClipInsets(full, full)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("never gives a negative inset when the inner rect pokes out", () => {
    const wide = { x: -10, y: -10, width: 1100, height: 700 };
    expect(resolveClipInsets(full, wide)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});

describe("formatClipInset", () => {
  it("writes a CSS inset with rounded corners", () => {
    expect(formatClipInset({ top: 1, right: 2, bottom: 3, left: 4 }, 6)).toBe(
      "inset(1px 2px 3px 4px round 6px)",
    );
  });
});

describe("buildMaximizeKeyframes", () => {
  it("grows the clip from the old rect to the whole cell", () => {
    const [start, end] = buildMaximizeKeyframes({
      from: slot,
      to: full,
      fromScrollTop: 0,
      radius: 8,
    });
    expect(start.clipPath).toBe("inset(308px 0px 0px 508px round 8px)");
    expect(end.clipPath).toBe("inset(0px 0px 0px 0px round 8px)");
  });

  it("subtracts the scroll offset the grid had before it scrolled to the top", () => {
    const [start] = buildMaximizeKeyframes({
      from: { ...slot, y: 608 },
      to: full,
      fromScrollTop: 300,
      radius: 8,
    });
    expect(start.clipPath).toBe("inset(308px 0px 0px 508px round 8px)");
  });
});

describe("buildRestoreKeyframes", () => {
  it("shrinks the clip to the slot and keeps one translate for the restored scroll", () => {
    const [start, end] = buildRestoreKeyframes({
      held: full,
      target: slot,
      toScrollTop: 0,
      radius: 8,
    });
    expect(start).toEqual({
      clipPath: "inset(0px 0px 0px 0px round 8px)",
      transform: "translateY(0px)",
    });
    expect(end.clipPath).toBe("inset(308px 0px 0px 508px round 8px)");
    expect(end.transform).toBe("translateY(0px)");
  });

  it("aims at the slot in the scrolled grid", () => {
    const [, end] = buildRestoreKeyframes({
      held: full,
      target: { ...slot, y: 608 },
      toScrollTop: 300,
      radius: 8,
    });
    expect(end.clipPath).toBe("inset(308px 0px 0px 508px round 8px)");
    expect(end.transform).toBe("translateY(300px)");
  });
});

describe("buildFadeKeyframes", () => {
  it("fades out to opacity 0 at scale .97 and cancels the scroll reset", () => {
    const { opacity, transform } = buildFadeKeyframes({ direction: "out", offsetY: -300 });
    expect(opacity).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(transform).toEqual([
      { transform: "translateY(-300px) scale(1)" },
      { transform: "translateY(-300px) scale(0.97)" },
    ]);
  });

  it("runs the same frames backwards when the cells return", () => {
    const { opacity, transform } = buildFadeKeyframes({ direction: "in", offsetY: 0 });
    expect(opacity).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(transform[0]).toEqual({ transform: "translateY(0px) scale(0.97)" });
  });
});
