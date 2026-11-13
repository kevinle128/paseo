import { describe, expect, it } from "vitest";
import { PENDING_PIN_FOCUS_TTL_MS, reducePendingPinFocus } from "./pending-pin-focus";

const picked = reducePendingPinFocus(null, { type: "picked", key: "h:a", now: 1000 }).state;

describe("reducePendingPinFocus", () => {
  it("holds the picked key until it expires", () => {
    expect(picked).toEqual({ key: "h:a", expiresAt: 1000 + PENDING_PIN_FOCUS_TTL_MS });
  });

  it("asks for focus when the key is pinned, and clears", () => {
    expect(
      reducePendingPinFocus(picked, {
        type: "pins-changed",
        pinnedKeys: ["h:b", "h:a"],
        now: 2000,
      }),
    ).toEqual({ state: null, focus: "h:a" });
  });

  it("keeps the key while it is not pinned and not expired", () => {
    expect(
      reducePendingPinFocus(picked, { type: "pins-changed", pinnedKeys: ["h:b"], now: 2000 }),
    ).toEqual({ state: picked });
  });

  it("clears when expired", () => {
    expect(
      reducePendingPinFocus(picked, {
        type: "pins-changed",
        pinnedKeys: [],
        now: 1000 + PENDING_PIN_FOCUS_TTL_MS,
      }),
    ).toEqual({ state: null });
  });

  it("does not focus a key that arrives after it expired", () => {
    expect(
      reducePendingPinFocus(picked, {
        type: "pins-changed",
        pinnedKeys: ["h:a"],
        now: 1000 + PENDING_PIN_FOCUS_TTL_MS + 1,
      }),
    ).toEqual({ state: null });
  });

  it("clears on a user focus change", () => {
    expect(reducePendingPinFocus(picked, { type: "user-focus" })).toEqual({ state: null });
  });

  it("stays null without a pending key", () => {
    expect(reducePendingPinFocus(null, { type: "user-focus" })).toEqual({ state: null });
    expect(
      reducePendingPinFocus(null, { type: "pins-changed", pinnedKeys: ["h:a"], now: 1 }),
    ).toEqual({ state: null });
  });
});
