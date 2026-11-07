import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { View } from "react-native";
import { isWeb } from "@/constants/platform";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { GridCellRect } from "./geometry";
import {
  hasCrossedDragThreshold,
  moveKey,
  rebasePreview,
  resolveAutoScrollStep,
  resolveDropIndex,
  shouldCancelDragOnInterrupt,
} from "./grid-reorder";

// Above the composer's `agent.interrupt` handler (200 while its input is focused), so Escape ends
// the drag instead of interrupting the agent. A tie would go to the handler registered last.
const DRAG_CANCEL_PRIORITY = 300;

export interface GridReorderDragInput {
  /** The deck node. It is the scroll container and the origin of slot rects. */
  deckRef: RefObject<View | null>;
  enabled: boolean;
  /** Committed cell order. */
  cellKeys: string[];
  /** Rect of a geometry slot in deck content coordinates. Slot `cellKeys.length` is the add cell. */
  slotRect: (index: number) => GridCellRect;
  onDragStart: (key: string) => void;
  /** The order other cells should preview, or null when the preview ends. */
  onPreview: (order: string[] | null) => void;
  onCommit: (order: string[]) => void;
  /** Runs once per animation frame while a drag runs. */
  onFrame?: () => void;
}

export interface GridReorderDrag {
  beginHeaderDrag: (key: string, event: PointerEvent, frameNode: HTMLElement) => void;
  draggedKey: string | null;
}

interface DragSession {
  key: string;
  node: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  startScrollTop: number;
  lastX: number;
  lastY: number;
  started: boolean;
  preview: string[] | null;
  currentIndex: number;
  knownKeys: Set<string>;
  rafId: number | null;
  bodyCursor: string;
  bodyUserSelect: string;
  dispose: () => void;
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function sameMembers(left: ReadonlySet<string>, right: readonly string[]): boolean {
  return left.size === right.length && right.every((key) => left.has(key));
}

export function useGridReorderDrag(input: GridReorderDragInput): GridReorderDrag {
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  });
  const sessionRef = useRef<DragSession | null>(null);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);

  const teardown = useCallback((session: DragSession) => {
    session.dispose();
    if (session.rafId !== null) {
      cancelAnimationFrame(session.rafId);
      session.rafId = null;
    }
    if (session.started) {
      session.node.style.transform = "";
      document.body.style.cursor = session.bodyCursor;
      document.body.style.userSelect = session.bodyUserSelect;
    }
    if (session.node.hasPointerCapture?.(session.pointerId)) {
      session.node.releasePointerCapture(session.pointerId);
    }
    sessionRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    teardown(session);
    if (session.started) {
      inputRef.current.onPreview(null);
      setDraggedKey(null);
    }
  }, [teardown]);

  const finish = useCallback(() => {
    const session = sessionRef.current;
    if (!session) {
      return;
    }
    teardown(session);
    if (!session.started) {
      return;
    }
    // The click that follows a drop would activate whatever sits under the pointer. It is
    // swallowed until the next task, so a missing click never eats a later real one.
    const swallowClick = (event: Event) => {
      event.stopPropagation();
      event.preventDefault();
    };
    window.addEventListener("click", swallowClick, true);
    setTimeout(() => window.removeEventListener("click", swallowClick, true), 0);
    const { cellKeys, onCommit, onPreview } = inputRef.current;
    if (session.preview && !sameOrder(session.preview, cellKeys)) {
      onCommit(session.preview);
    }
    onPreview(null);
    setDraggedKey(null);
  }, [teardown]);

  const updateDrag = useCallback((session: DragSession) => {
    const deck: unknown = inputRef.current.deckRef.current;
    if (!(deck instanceof HTMLElement)) {
      return;
    }
    const dx = session.lastX - session.startX;
    const dy = session.lastY - session.startY + (deck.scrollTop - session.startScrollTop);
    session.node.style.transform = `translate(${dx}px, ${dy}px)`;
    const deckBox = deck.getBoundingClientRect();
    const index = resolveDropIndex({
      point: {
        x: session.lastX - deckBox.left,
        y: session.lastY - deckBox.top + deck.scrollTop,
      },
      slotRect: inputRef.current.slotRect,
      cellCount: inputRef.current.cellKeys.length,
      currentIndex: session.currentIndex,
    });
    if (index !== session.currentIndex) {
      session.currentIndex = index;
      session.preview = moveKey(inputRef.current.cellKeys, session.key, index);
      inputRef.current.onPreview(session.preview);
    }
  }, []);

  const startDrag = useCallback(
    (session: DragSession) => {
      session.started = true;
      session.bodyCursor = document.body.style.cursor;
      session.bodyUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
      window.getSelection()?.removeAllRanges();
      try {
        session.node.setPointerCapture(session.pointerId);
      } catch {
        // The pointer already ended; the window listeners still deliver the rest of the gesture.
      }
      session.node.addEventListener("lostpointercapture", cancel);
      const previousDispose = session.dispose;
      session.dispose = () => {
        session.node.removeEventListener("lostpointercapture", cancel);
        previousDispose();
      };
      setDraggedKey(session.key);
      inputRef.current.onDragStart(session.key);
      const tick = () => {
        session.rafId = null;
        const deck: unknown = inputRef.current.deckRef.current;
        if (deck instanceof HTMLElement) {
          const box = deck.getBoundingClientRect();
          const step = resolveAutoScrollStep({
            pointerY: session.lastY,
            viewportTop: box.top,
            viewportBottom: box.bottom,
          });
          if (step !== 0) {
            const before = deck.scrollTop;
            deck.scrollTop = before + step;
            if (deck.scrollTop !== before) {
              updateDrag(session);
            }
          }
        }
        inputRef.current.onFrame?.();
        if (sessionRef.current === session) {
          session.rafId = requestAnimationFrame(tick);
        }
      };
      session.rafId = requestAnimationFrame(tick);
    },
    [cancel, updateDrag],
  );

  const beginHeaderDrag = useCallback(
    (key: string, event: PointerEvent, frameNode: HTMLElement) => {
      const current = inputRef.current;
      if (
        !isWeb ||
        !current.enabled ||
        sessionRef.current ||
        event.button !== 0 ||
        event.pointerType !== "mouse"
      ) {
        return;
      }
      const deck: unknown = current.deckRef.current;
      const index = current.cellKeys.indexOf(key);
      if (index === -1) {
        return;
      }
      const session: DragSession = {
        key,
        node: frameNode,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startScrollTop: deck instanceof HTMLElement ? deck.scrollTop : 0,
        lastX: event.clientX,
        lastY: event.clientY,
        started: false,
        preview: null,
        currentIndex: index,
        knownKeys: new Set(current.cellKeys),
        rafId: null,
        bodyCursor: "",
        bodyUserSelect: "",
        dispose: () => undefined,
      };
      const handleMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== session.pointerId) {
          return;
        }
        session.lastX = moveEvent.clientX;
        session.lastY = moveEvent.clientY;
        if (!session.started) {
          if (
            !hasCrossedDragThreshold(session.lastX - session.startX, session.lastY - session.startY)
          ) {
            return;
          }
          startDrag(session);
        }
        updateDrag(session);
      };
      const handleUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId === session.pointerId) {
          finish();
        }
      };
      const handleCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId === session.pointerId) {
          cancel();
        }
      };
      // A native HTML drag (image, selected text) would end the pointer stream with pointercancel.
      const preventNativeDrag = (dragEvent: Event) => dragEvent.preventDefault();
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleCancel);
      window.addEventListener("blur", cancel);
      frameNode.addEventListener("dragstart", preventNativeDrag, true);
      session.dispose = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleCancel);
        window.removeEventListener("blur", cancel);
        frameNode.removeEventListener("dragstart", preventNativeDrag, true);
      };
      sessionRef.current = session;
    },
    [cancel, finish, startDrag, updateDrag],
  );

  // Every exit other than a drop goes through cancel(), so a grid that stops showing never keeps
  // a transform, body styles or a pending commit.
  useEffect(() => {
    if (!input.enabled) {
      cancel();
    }
  }, [cancel, input.enabled]);

  useEffect(() => cancel, [cancel]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session || sameMembers(session.knownKeys, input.cellKeys)) {
      return;
    }
    if (!input.cellKeys.includes(session.key)) {
      cancel();
      return;
    }
    session.knownKeys = new Set(input.cellKeys);
    if (!session.started) {
      return;
    }
    session.preview = rebasePreview({
      preview: session.preview ?? input.cellKeys,
      cellKeys: input.cellKeys,
    });
    session.currentIndex = session.preview.indexOf(session.key);
    inputRef.current.onPreview(session.preview);
  }, [cancel, input.cellKeys]);

  useKeyboardActionHandler({
    handlerId: "workspace-grid-cell-drag-cancel",
    actions: ["agent.interrupt"] as const,
    enabled: draggedKey !== null,
    priority: DRAG_CANCEL_PRIORITY,
    isActive: () => true,
    handle: () => {
      if (!shouldCancelDragOnInterrupt(draggedKey)) {
        return false;
      }
      cancel();
      return true;
    },
  });

  return { beginHeaderDrag, draggedKey };
}
