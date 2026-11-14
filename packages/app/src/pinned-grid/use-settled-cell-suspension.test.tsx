/**
 * @vitest-environment jsdom
 */
import { act } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CELL_TRANSITION_SETTLE_MS } from "./cell-transition";
import { useSettledCellSuspension } from "./use-settled-cell-suspension";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Input {
  hidden: boolean;
  underMaximized: boolean;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let suspended: boolean | null = null;

function Probe(props: Input) {
  suspended = useSettledCellSuspension(props);
  return null;
}

function render(input: Input) {
  act(() => {
    root?.render(<Probe {...input} />);
  });
}

function setReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reduce }) as typeof window.matchMedia;
}

beforeEach(() => {
  vi.useFakeTimers();
  setReducedMotion(false);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  suspended = null;
  vi.useRealTimers();
});

describe("useSettledCellSuspension", () => {
  it("keeps a restored cell suspended until the motion settles", () => {
    render({ hidden: true, underMaximized: true });
    expect(suspended).toBe(true);

    render({ hidden: false, underMaximized: false });
    expect(suspended).toBe(true);

    act(() => vi.advanceTimersByTime(CELL_TRANSITION_SETTLE_MS - 1));
    expect(suspended).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(suspended).toBe(false);
  });

  it("does not suspend a cell that was still shown when the maximize ended", () => {
    render({ hidden: false, underMaximized: false });
    render({ hidden: false, underMaximized: true });
    expect(suspended).toBe(false);

    render({ hidden: false, underMaximized: false });
    expect(suspended).toBe(false);
  });

  it("suspends a cell when its held presence turns hidden after the fade", () => {
    render({ hidden: false, underMaximized: false });
    render({ hidden: false, underMaximized: true });
    expect(suspended).toBe(false);

    render({ hidden: true, underMaximized: true });
    expect(suspended).toBe(true);
  });

  it("restarts the hold when a maximize starts again during it", () => {
    render({ hidden: true, underMaximized: true });
    render({ hidden: false, underMaximized: false });
    act(() => vi.advanceTimersByTime(CELL_TRANSITION_SETTLE_MS - 100));

    render({ hidden: false, underMaximized: true });
    act(() => vi.advanceTimersByTime(CELL_TRANSITION_SETTLE_MS - 1));
    expect(suspended).toBe(true);
  });

  it("resumes at once on a presence change without a maximize change", () => {
    render({ hidden: true, underMaximized: false });
    expect(suspended).toBe(true);

    render({ hidden: false, underMaximized: false });
    expect(suspended).toBe(false);
  });

  it("resumes at once with reduced motion", () => {
    setReducedMotion(true);
    render({ hidden: true, underMaximized: true });

    render({ hidden: false, underMaximized: false });
    expect(suspended).toBe(false);
  });
});
