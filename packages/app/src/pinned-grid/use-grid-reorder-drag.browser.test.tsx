import React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import {
  KeyboardActionDispatcherProvider,
  useKeyboardActionDispatcher,
} from "@/keyboard/keyboard-action-dispatcher-context";
import type { GridCellRect } from "./geometry";
import { useGridReorderDrag, type GridReorderDrag } from "./use-grid-reorder-drag";

const SLOT_WIDTH = 200;
const SLOT_HEIGHT = 100;

function slotRect(index: number): GridCellRect {
  return {
    x: (index % 2) * (SLOT_WIDTH + 8),
    y: Math.floor(index / 2) * (SLOT_HEIGHT + 8),
    width: SLOT_WIDTH,
    height: SLOT_HEIGHT,
  };
}

interface Harness {
  root: Root;
  container: HTMLElement;
  frame: HTMLElement;
  deck: HTMLElement;
  drag: () => GridReorderDrag;
  dispatchInterrupt: () => boolean;
  rerender: (props: Partial<HarnessProps>) => void;
  calls: ReturnType<typeof makeCalls>;
  composerInterrupt: ReturnType<typeof vi.fn<() => boolean>>;
}

interface HarnessProps {
  enabled: boolean;
  cellKeys: string[];
}

function makeCalls() {
  return {
    onDragStart: vi.fn<(key: string) => void>(),
    onPreview: vi.fn<(order: string[] | null) => void>(),
    onCommit: vi.fn<(order: string[]) => void>(),
    onFrame: vi.fn<() => void>(),
  };
}

function setup(initial: HarnessProps = { enabled: true, cellKeys: ["a", "b", "c"] }): Harness {
  const container = document.createElement("div");
  document.body.append(container);
  const deck = document.createElement("div");
  deck.style.cssText = "position:relative;width:408px;height:300px;overflow:auto;";
  const frame = document.createElement("div");
  frame.style.cssText = "position:absolute;left:0;top:0;width:200px;height:100px;";
  const header = document.createElement("div");
  header.textContent = "header";
  frame.append(header);
  deck.append(frame);
  container.append(deck);

  const calls = makeCalls();
  let latest: GridReorderDrag | null = null;
  let dispatcher: ReturnType<typeof useKeyboardActionDispatcher> | null = null;
  const deckRef = { current: deck as never };
  // Stands in for the focused composer's interrupt handler (priority 200).
  const composerInterrupt = vi.fn<() => boolean>(() => true);

  function Probe(props: HarnessProps) {
    useKeyboardActionHandler({
      handlerId: "test-composer-interrupt",
      actions: ["agent.interrupt"] as const,
      enabled: true,
      priority: 200,
      isActive: () => true,
      handle: composerInterrupt,
    });
    dispatcher = useKeyboardActionDispatcher();
    latest = useGridReorderDrag({
      deckRef,
      enabled: props.enabled,
      cellKeys: props.cellKeys,
      slotRect,
      ...calls,
    });
    return null;
  }
  const mount = document.createElement("div");
  container.append(mount);
  const root = createRoot(mount);
  const render = (props: HarnessProps) =>
    flushSync(() =>
      root.render(
        <KeyboardActionDispatcherProvider>
          <Probe {...props} />
        </KeyboardActionDispatcherProvider>,
      ),
    );
  let current = initial;
  render(current);
  return {
    root,
    container,
    frame,
    deck,
    calls,
    composerInterrupt,
    drag: () => latest as GridReorderDrag,
    dispatchInterrupt: () =>
      dispatcher!.dispatch({ id: "agent.interrupt", scope: "message-input" }),
    rerender: (next) => {
      current = { ...current, ...next };
      render(current);
    },
  };
}

function pointer(type: string, x: number, y: number, extra: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, {
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
}

function press(h: Harness, x = 10, y = 10, extra: PointerEventInit = {}) {
  const event = pointer("pointerdown", x, y, extra);
  flushSync(() => h.drag().beginHeaderDrag("a", event, h.frame));
}

function move(x: number, y: number) {
  flushSync(() => {
    window.dispatchEvent(pointer("pointermove", x, y));
  });
}

function release(x: number, y: number) {
  flushSync(() => {
    window.dispatchEvent(pointer("pointerup", x, y));
  });
}

let harness: Harness | null = null;

beforeEach(() => {
  harness = null;
  window.getSelection()?.removeAllRanges();
});

afterEach(() => {
  harness?.root.unmount();
  harness?.container.remove();
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

function use(initial?: HarnessProps): Harness {
  harness = setup(initial);
  return harness;
}

// Pointer position of slot 1 (second cell) relative to the viewport.
function slotCenter(h: Harness, index: number) {
  const box = h.deck.getBoundingClientRect();
  const rect = slotRect(index);
  return { x: box.left + rect.x + 20, y: box.top + rect.y + 20 };
}

describe("useGridReorderDrag", () => {
  it("does nothing below the threshold and leaves dblclick alone", () => {
    const h = use();
    press(h, 10, 10);
    move(13, 10);
    expect(h.calls.onDragStart).not.toHaveBeenCalled();
    release(13, 10);
    const dbl = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
    h.frame.dispatchEvent(dbl);
    expect(dbl.defaultPrevented).toBe(false);
    expect(h.drag().draggedKey).toBeNull();
  });

  it("ignores touch pointers at any distance", () => {
    const h = use();
    press(h, 10, 10, { pointerType: "touch" });
    move(200, 200);
    expect(h.calls.onDragStart).not.toHaveBeenCalled();
  });

  it("starts after 10 px, sets the transform and clears the selection", () => {
    const h = use();
    const range = document.createRange();
    range.selectNodeContents(h.frame);
    window.getSelection()?.addRange(range);
    press(h, 10, 10);
    move(20, 10);
    expect(h.calls.onDragStart).toHaveBeenCalledTimes(1);
    expect(h.calls.onDragStart).toHaveBeenCalledWith("a");
    expect(h.frame.style.transform).toContain("translate(10px");
    expect(window.getSelection()?.rangeCount).toBe(0);
    expect(document.body.style.cursor).toBe("grabbing");
    expect(h.drag().draggedKey).toBe("a");
  });

  it("commits the new order on drop and restores styles", () => {
    const h = use();
    press(h, 10, 10);
    move(20, 10);
    const target = slotCenter(h, 1);
    move(target.x, target.y);
    expect(h.calls.onPreview).toHaveBeenLastCalledWith(["b", "a", "c"]);
    release(target.x, target.y);
    expect(h.calls.onCommit).toHaveBeenCalledWith(["b", "a", "c"]);
    expect(h.calls.onPreview).toHaveBeenLastCalledWith(null);
    expect(h.frame.style.transform).toBe("");
    expect(document.body.style.cursor).toBe("");
    expect(h.drag().draggedKey).toBeNull();
  });

  it("does not commit when the order did not change", () => {
    const h = use();
    press(h, 10, 10);
    move(40, 20);
    release(40, 20);
    expect(h.calls.onCommit).not.toHaveBeenCalled();
  });

  it("swallows the click after a drop only until the next task", async () => {
    const h = use();
    press(h, 10, 10);
    move(40, 20);
    release(40, 20);
    const swallowed = vi.fn();
    h.container.addEventListener("click", swallowed);
    h.frame.click();
    expect(swallowed).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 5));
    h.frame.click();
    expect(swallowed).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["pointercancel", () => window.dispatchEvent(pointer("pointercancel", 0, 0))],
    ["window blur", () => window.dispatchEvent(new Event("blur"))],
    ["lostpointercapture", (h: Harness) => h.frame.dispatchEvent(new Event("lostpointercapture"))],
  ])("cancels on %s without a commit", (_name, trigger) => {
    const h = use();
    press(h, 10, 10);
    move(40, 20);
    flushSync(() => {
      trigger(h);
    });
    expect(h.calls.onCommit).not.toHaveBeenCalled();
    expect(h.calls.onPreview).toHaveBeenLastCalledWith(null);
    expect(h.frame.style.transform).toBe("");
    expect(document.body.style.userSelect).toBe("");
    expect(h.drag().draggedKey).toBeNull();
  });

  it("cancels when drag turns off mid-drag", () => {
    const h = use();
    press(h, 10, 10);
    move(40, 20);
    h.rerender({ enabled: false });
    expect(h.calls.onCommit).not.toHaveBeenCalled();
    expect(h.calls.onPreview).toHaveBeenLastCalledWith(null);
    expect(h.frame.style.transform).toBe("");
  });

  it("cancels when the dragged key leaves the cells", () => {
    const h = use();
    press(h, 10, 10);
    move(40, 20);
    h.rerender({ cellKeys: ["b", "c"] });
    expect(h.calls.onCommit).not.toHaveBeenCalled();
    expect(h.calls.onPreview).toHaveBeenLastCalledWith(null);
    expect(h.frame.style.transform).toBe("");
  });

  it("rebases the preview when a key joins mid-drag", () => {
    const h = use();
    press(h, 10, 10);
    move(40, 20);
    h.rerender({ cellKeys: ["a", "b", "c", "d"] });
    expect(h.calls.onPreview).toHaveBeenLastCalledWith(["a", "b", "c", "d"]);
  });

  it("prevents a native dragstart while the press is pending", () => {
    const h = use();
    press(h, 10, 10);
    const header = h.frame.firstElementChild as HTMLElement;
    const event = new Event("dragstart", { bubbles: true, cancelable: true });
    header.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("cancels the drag on Escape ahead of a competing priority-200 handler", () => {
    const h = use();
    expect(h.dispatchInterrupt()).toBe(true);
    expect(h.composerInterrupt).toHaveBeenCalledTimes(1);
    h.composerInterrupt.mockClear();
    press(h, 10, 10);
    move(40, 20);
    let handled = false;
    flushSync(() => {
      handled = h.dispatchInterrupt();
    });
    expect(handled).toBe(true);
    expect(h.composerInterrupt).not.toHaveBeenCalled();
    expect(h.calls.onCommit).not.toHaveBeenCalled();
    expect(h.calls.onPreview).toHaveBeenLastCalledWith(null);
    expect(h.dispatchInterrupt()).toBe(true);
    expect(h.composerInterrupt).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape before a focused terminal-like element sees the key", () => {
    const h = use();
    const terminal = document.createElement("textarea");
    terminal.className = "xterm-helper-textarea";
    h.container.append(terminal);
    const reached = vi.fn();
    terminal.addEventListener("keydown", reached);
    terminal.focus();
    press(h, 10, 10);
    move(40, 20);
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    flushSync(() => {
      terminal.dispatchEvent(escape);
    });
    expect(reached).not.toHaveBeenCalled();
    expect(escape.defaultPrevented).toBe(true);
    expect(h.calls.onCommit).not.toHaveBeenCalled();
    expect(h.calls.onPreview).toHaveBeenLastCalledWith(null);
    expect(h.frame.style.transform).toBe("");
    expect(h.drag().draggedKey).toBeNull();
  });

  it("leaves Escape alone outside a drag and for other keys during one", () => {
    const h = use();
    const terminal = document.createElement("textarea");
    h.container.append(terminal);
    const reached = vi.fn();
    terminal.addEventListener("keydown", reached);
    terminal.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(reached).toHaveBeenCalledTimes(1);
    press(h, 10, 10);
    move(40, 20);
    terminal.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }),
    );
    expect(reached).toHaveBeenCalledTimes(2);
    expect(h.drag().draggedKey).toBe("a");
  });

  it("auto-scrolls near both edges and reports each frame", async () => {
    const h = use();
    const filler = document.createElement("div");
    filler.style.cssText = "position:absolute;top:0;left:0;width:1px;height:2000px;";
    h.deck.append(filler);
    h.deck.scrollTop = 200;
    const box = h.deck.getBoundingClientRect();
    press(h, box.left + 10, box.top + 150);
    move(box.left + 10, box.bottom - 4);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(h.deck.scrollTop).toBeGreaterThan(200);
    expect(h.calls.onFrame).toHaveBeenCalled();
    const afterDown = h.deck.scrollTop;
    move(box.left + 10, box.top + 4);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(h.deck.scrollTop).toBeLessThan(afterDown);
  });
});
