import { describe, expect, it } from "vitest";
import { createPointerFocusClaim } from "./cell-press-guard";

describe("createPointerFocusClaim", () => {
  it("keeps the claim when a key is pressed during the pointer gesture", () => {
    const claim = createPointerFocusClaim();
    claim.pointerDown(true);
    claim.keyDown();
    expect(claim.isClaimed()).toBe(true);
  });

  it("lets a key end the claim once the gesture has finished", () => {
    const claim = createPointerFocusClaim();
    claim.pointerDown(true);
    claim.pointerEnd();
    claim.keyDown();
    expect(claim.isClaimed()).toBe(false);
  });

  it("ends the claim on release", () => {
    const claim = createPointerFocusClaim();
    claim.pointerDown(true);
    claim.release();
    expect(claim.isClaimed()).toBe(false);
  });

  it("does not claim a gesture that did not move focus", () => {
    const claim = createPointerFocusClaim();
    claim.pointerDown(false);
    expect(claim.isClaimed()).toBe(false);
  });
});
