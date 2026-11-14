import { describe, expect, it } from "vitest";
import {
  buildFadeKeyframes,
  buildFlipKeyframes,
  buildFlipTransform,
  buildMaximizeKeyframes,
  buildRestoreKeyframes,
} from "./cell-transition";

const full = { x: 0, y: 0, width: 1000, height: 600 };
const slot = { x: 500, y: 300, width: 500, height: 300 };
const identity = { transform: "translate(0px, 0px) scale(1, 1)" };

describe("buildFlipTransform", () => {
  it("draws the full layout over the slot", () => {
    expect(buildFlipTransform(slot, full)).toBe("translate(500px, 300px) scale(0.5, 0.5)");
  });

  it("draws the slot layout over the full rect", () => {
    expect(buildFlipTransform(full, slot)).toBe("translate(-500px, -300px) scale(2, 2)");
  });

  it("gives the identity for equal rects", () => {
    expect(buildFlipTransform(full, full)).toBe(identity.transform);
  });

  it("does not scale an axis of a box that has no size", () => {
    expect(buildFlipTransform(full, { x: 0, y: 0, width: 0, height: 0 })).toBe(
      "translate(0px, 0px) scale(1, 1)",
    );
  });
});

describe("buildFlipKeyframes", () => {
  it("ends at the identity written in the same form as the start", () => {
    expect(buildFlipKeyframes(slot, full)).toEqual([
      { transform: "translate(500px, 300px) scale(0.5, 0.5)" },
      identity,
    ]);
  });
});

describe("buildMaximizeKeyframes", () => {
  it("starts the full layout drawn over the old slot", () => {
    expect(buildMaximizeKeyframes({ from: slot, to: full, fromScrollTop: 0 })).toEqual([
      { transform: "translate(500px, 300px) scale(0.5, 0.5)" },
      identity,
    ]);
  });

  it("subtracts the scroll offset the grid had before it scrolled to the top", () => {
    const [start] = buildMaximizeKeyframes({
      from: { ...slot, y: 600 },
      to: full,
      fromScrollTop: 300,
    });
    expect(start.transform).toBe("translate(500px, 300px) scale(0.5, 0.5)");
  });
});

describe("buildRestoreKeyframes", () => {
  it("starts the slot layout drawn over the viewport", () => {
    expect(buildRestoreKeyframes({ maximized: full, slot, toScrollTop: 0 })).toEqual([
      { transform: "translate(-500px, -300px) scale(2, 2)" },
      identity,
    ]);
  });

  it("starts at the viewport of the grid scrolled back to its offset", () => {
    const [start] = buildRestoreKeyframes({
      maximized: full,
      slot: { ...slot, y: 600 },
      toScrollTop: 300,
    });
    expect(start.transform).toBe("translate(-500px, -300px) scale(2, 2)");
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
