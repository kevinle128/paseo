import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SMOOTH_REVEAL_TTL_MS,
  consumeSmoothReveal,
  markSmoothReveal,
  requestCellReveal,
  subscribeCellReveal,
} from "./cell-reveal-request";

describe("cell reveal request", () => {
  it("delivers the requested key to a subscribed listener", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCellReveal(listener);
    requestCellReveal("srv:ws");
    expect(listener).toHaveBeenCalledWith("srv:ws");
    unsubscribe();
  });

  it("does not deliver to an unsubscribed listener", () => {
    const listener = vi.fn();
    subscribeCellReveal(listener)();
    requestCellReveal("srv:ws");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("smooth reveal mark", () => {
  const NOW = 1_000;

  beforeEach(() => {
    // Expires any mark a previous test left behind.
    consumeSmoothReveal("", Number.MAX_SAFE_INTEGER);
  });

  it("is consumed once for the marked key", () => {
    markSmoothReveal("srv:ws", NOW);
    expect(consumeSmoothReveal("srv:ws", NOW + 1)).toBe(true);
    expect(consumeSmoothReveal("srv:ws", NOW + 2)).toBe(false);
  });

  it("is not consumed by another key, and stays for its own key", () => {
    markSmoothReveal("srv:ws", NOW);
    expect(consumeSmoothReveal("srv:other", NOW + 1)).toBe(false);
    expect(consumeSmoothReveal("srv:ws", NOW + 2)).toBe(true);
  });

  it("expires, so a later scroll to the same cell jumps", () => {
    markSmoothReveal("srv:ws", NOW);
    expect(consumeSmoothReveal("srv:ws", NOW + SMOOTH_REVEAL_TTL_MS)).toBe(false);
    expect(consumeSmoothReveal("srv:ws", NOW + SMOOTH_REVEAL_TTL_MS + 1)).toBe(false);
  });

  it("keeps only the latest mark", () => {
    markSmoothReveal("srv:a", NOW);
    markSmoothReveal("srv:b", NOW);
    expect(consumeSmoothReveal("srv:a", NOW + 1)).toBe(false);
    expect(consumeSmoothReveal("srv:b", NOW + 1)).toBe(true);
  });

  it("is false when nothing is marked", () => {
    expect(consumeSmoothReveal("srv:ws", NOW)).toBe(false);
  });
});
