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

  it("tells subscribers whether the grid scrolled or only its layout moved", () => {
    const signal = createGridScrollSignal();
    const listener = vi.fn();
    signal.subscribe(listener);

    signal.notify();
    signal.notify("layout");

    expect(listener).toHaveBeenNthCalledWith(1, "scroll");
    expect(listener).toHaveBeenNthCalledWith(2, "layout");
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

  it("keeps the scroll offset it was given", () => {
    const signal = createGridScrollSignal();
    expect(signal.getScrollTop()).toBe(0);

    signal.setScrollTop(724);

    expect(signal.getScrollTop()).toBe(724);
  });
});
