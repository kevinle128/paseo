import { describe, expect, it } from "vitest";
import { clipViewportToRect } from "./fullscreen";

describe("clipViewportToRect", () => {
  const viewport = { top: 0, left: 0, width: 1000, height: 800 };

  it("returns the viewport when there is no grid", () => {
    expect(clipViewportToRect(viewport, null)).toBe(viewport);
  });

  it("clips the viewport to the scrolling grid's visible area", () => {
    expect(clipViewportToRect(viewport, { left: 320, top: 40, right: 960, bottom: 700 })).toEqual({
      left: 320,
      top: 40,
      width: 640,
      height: 660,
    });
  });

  it("collapses to an empty frame when the grid is outside the viewport", () => {
    expect(
      clipViewportToRect(viewport, { left: 1200, top: 0, right: 1400, bottom: 100 }),
    ).toMatchObject({ width: 0 });
  });
});
