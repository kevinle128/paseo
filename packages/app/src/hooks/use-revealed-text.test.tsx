/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StreamFidelityProvider, type StreamFidelity } from "@/pinned-grid/stream-fidelity-context";
import { ReducedFidelityClock } from "@/pinned-grid/reduced-fidelity-clock";
import { useRevealedText } from "./use-revealed-text";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const clock = new ReducedFidelityClock(
  { setTimeout: () => 1, clearTimeout: () => undefined, now: () => 0 },
  { periodMs: 100, slots: 1 },
);

describe("useRevealedText", () => {
  let container: HTMLDivElement;
  let root: Root;
  let shown: string[];
  let frames: Array<(timestamp: number) => void>;

  function Reader({ text }: { text: string }) {
    shown.push(useRevealedText(text, "streaming"));
    return null;
  }

  function render(text: string, fidelity: StreamFidelity) {
    act(() => {
      root.render(
        <StreamFidelityProvider fidelity={fidelity} clock={clock}>
          <Reader text={text} />
        </StreamFidelityProvider>,
      );
    });
  }

  beforeEach(() => {
    shown = [];
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (callback: (timestamp: number) => void) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  it("shows text that grows past the first sight only in part when paced", () => {
    render("Hello", "full");
    render("Hello world, this is a longer streamed answer.", "full");
    expect(shown.at(-1)?.length).toBeLessThan(
      "Hello world, this is a longer streamed answer.".length,
    );
    expect(frames.length).toBeGreaterThan(0);
  });

  it("shows grown text whole and schedules no frame when reduced", () => {
    render("Hello", "reduced");
    shown.length = 0;
    render("Hello world, this is a longer streamed answer.", "reduced");
    expect(shown.every((value) => value === "Hello world, this is a longer streamed answer.")).toBe(
      true,
    );
    expect(frames).toHaveLength(0);
  });

  it("does not jump back when a reduced cell becomes full", () => {
    render("Hello world, this is a longer streamed answer.", "reduced");
    render("Hello world, this is a longer streamed answer.", "full");
    expect(shown.at(-1)).toBe("Hello world, this is a longer streamed answer.");
  });
});
