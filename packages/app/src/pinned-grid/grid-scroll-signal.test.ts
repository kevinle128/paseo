import { describe, expect, it, vi } from "vitest";
import { createGridScrollSignal } from "./grid-scroll-signal";

describe("createGridScrollSignal", () => {
  it("notifies every subscriber on scroll", () => {
    const signal = createGridScrollSignal();
    const first = vi.fn();
    const second = vi.fn();
    signal.subscribe(first);
    signal.subscribe(second);

    signal.notify();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops notifying after unsubscribe", () => {
    const signal = createGridScrollSignal();
    const listener = vi.fn();
    const unsubscribe = signal.subscribe(listener);

    unsubscribe();
    signal.notify();

    expect(listener).not.toHaveBeenCalled();
  });

  it("reports no viewport rect until the grid element is set and attached", () => {
    const signal = createGridScrollSignal();
    expect(signal.getViewportRect()).toBeNull();
    const element = {
      isConnected: true,
      getBoundingClientRect: () => ({ left: 10, top: 20, right: 110, bottom: 220 }),
    } as unknown as HTMLElement;

    signal.setViewport(element);
    expect(signal.getViewportRect()).toEqual({ left: 10, top: 20, right: 110, bottom: 220 });

    signal.setViewport(null);
    expect(signal.getViewportRect()).toBeNull();
  });
});
