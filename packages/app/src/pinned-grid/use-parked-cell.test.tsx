/**
 * @vitest-environment jsdom
 */
import { act } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useParkedCell } from "./use-parked-cell";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Input {
  underMaximized: boolean;
  isPresented: boolean;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let parked: boolean | null = null;

function Probe(props: Input) {
  parked = useParkedCell(props);
  return null;
}

function render(input: Input) {
  act(() => {
    root?.render(<Probe {...input} />);
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  parked = null;
});

describe("useParkedCell", () => {
  it("parks a cell that was on screen when the maximize started, until it ends", () => {
    render({ underMaximized: false, isPresented: true });
    expect(parked).toBe(false);

    // The render that starts the maximize can already see the cell hidden.
    render({ underMaximized: true, isPresented: false });
    expect(parked).toBe(true);

    render({ underMaximized: false, isPresented: true });
    expect(parked).toBe(false);
  });

  it("does not park a cell that was hidden when the maximize started", () => {
    render({ underMaximized: false, isPresented: false });
    render({ underMaximized: true, isPresented: false });
    expect(parked).toBe(false);
  });

  it("does not park a cell outside a maximize", () => {
    render({ underMaximized: false, isPresented: true });
    render({ underMaximized: false, isPresented: false });
    expect(parked).toBe(false);
  });
});
