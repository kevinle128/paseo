import { describe, expect, it, vi } from "vitest";
import { requestCellReveal, subscribeCellReveal } from "./cell-reveal-request";

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
