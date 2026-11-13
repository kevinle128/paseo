import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { View } from "react-native";
import { isNative } from "@/constants/platform";
import {
  buildFadeKeyframes,
  buildMaximizeKeyframes,
  buildRestoreKeyframes,
  CELL_FADE_EASING,
  CELL_FADE_MS,
  CELL_TRANSITION_EASING,
  CELL_TRANSITION_MS,
  prefersReducedMotion,
} from "./cell-transition";
import type { GridCellRect } from "./geometry";

/** The grid scroll offset, read from the deck that contains `node`. */
function readDeckScrollTop(node: unknown): number {
  if (!(node instanceof HTMLElement)) {
    return 0;
  }
  const deck = node.closest('[data-testid="workspace-deck"]');
  return deck instanceof HTMLElement ? deck.scrollTop : 0;
}

/**
 * The cell is laid out once at its final size and only a clip (maximize, restore) or opacity and
 * transform (the other cells) animate, so no workspace relayouts while it moves.
 */
type CellMotion =
  | { kind: "maximize"; from: GridCellRect; scrollTop: number }
  | { kind: "restore"; held: GridCellRect };

type CellFade = { kind: "out"; scrollTop: number } | { kind: "in" };

/**
 * Drives the maximize and restore motion of one cell frame, and the fade of the cells around it.
 * Returns the rect the frame lays out at: during a restore it is the large rect, until the clip
 * reaches the slot.
 */
export function useCellMotion(input: {
  frameRef: RefObject<View | null>;
  isCell: boolean;
  isVisible: boolean;
  rect: GridCellRect | null;
  isMaximized: boolean;
  underMaximized: boolean;
}): { layoutRect: GridCellRect | null; isMoving: boolean } {
  const { frameRef, isCell, isVisible, rect, isMaximized, underMaximized } = input;
  // Motion starts only on the commit that changes `isMaximized` or `underMaximized`. The state is
  // adjusted during render so the new layout and the motion reach the DOM together. Drags,
  // resizes, first mount and reduced motion never set it.
  const lastRectRef = useRef<GridCellRect | null>(rect);
  const [seenMaximized, setSeenMaximized] = useState(isMaximized);
  const [motion, setMotion] = useState<CellMotion | null>(null);
  const [seenUnder, setSeenUnder] = useState(underMaximized);
  const [fade, setFade] = useState<CellFade | null>(null);
  const canAnimate = isCell && !isNative && !prefersReducedMotion();
  if (seenMaximized !== isMaximized) {
    setSeenMaximized(isMaximized);
    const previous = lastRectRef.current;
    if (!canAnimate || !previous || !rect) {
      setMotion(null);
    } else if (isMaximized) {
      setMotion({
        kind: "maximize",
        from: previous,
        scrollTop: readDeckScrollTop(frameRef.current),
      });
    } else {
      setMotion({ kind: "restore", held: previous });
    }
  }
  if (seenUnder !== underMaximized) {
    setSeenUnder(underMaximized);
    if (!canAnimate) {
      setFade(null);
    } else if (underMaximized) {
      setFade(isVisible ? { kind: "out", scrollTop: readDeckScrollTop(frameRef.current) } : null);
    } else {
      setFade(isVisible ? { kind: "in" } : null);
    }
  }
  const layoutRect = motion?.kind === "restore" ? motion.held : rect;
  useLayoutEffect(() => {
    lastRectRef.current = layoutRect;
  }, [layoutRect]);

  useLayoutEffect(() => {
    const node: unknown = frameRef.current;
    if (!motion || !(node instanceof HTMLElement) || !layoutRect) {
      return undefined;
    }
    const radius = parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0;
    const options = {
      duration: CELL_TRANSITION_MS,
      easing: CELL_TRANSITION_EASING,
      fill: "forwards",
    } as const;
    let cancelled = false;
    let animation: Animation | null = null;
    const start = (keyframes: Keyframe[]) => {
      node.style.willChange = "clip-path, transform";
      animation = node.animate(keyframes, options);
      animation.onfinish = () => {
        if (!cancelled) {
          setMotion(null);
        }
      };
    };
    if (motion.kind === "maximize") {
      start(
        buildMaximizeKeyframes({
          from: motion.from,
          to: layoutRect,
          fromScrollTop: motion.scrollTop,
          radius,
        }),
      );
    } else if (rect) {
      // The grid restores its scroll offset in a parent layout effect that runs after this one.
      // The microtask runs before the next paint and sees the restored offset.
      queueMicrotask(() => {
        if (cancelled) {
          return;
        }
        start(
          buildRestoreKeyframes({
            held: motion.held,
            target: rect,
            toScrollTop: readDeckScrollTop(node),
            radius,
          }),
        );
      });
    }
    return () => {
      cancelled = true;
      animation?.cancel();
      node.style.willChange = "";
    };
    // `rect` and `layoutRect` are read only when the motion starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion]);

  useLayoutEffect(() => {
    const node: unknown = frameRef.current;
    if (!fade || !(node instanceof HTMLElement)) {
      return undefined;
    }
    const { opacity, transform } = buildFadeKeyframes({
      direction: fade.kind,
      offsetY: fade.kind === "out" ? -fade.scrollTop : 0,
    });
    node.style.willChange = "opacity, transform";
    const animations = [
      node.animate(opacity, { duration: CELL_FADE_MS, easing: CELL_FADE_EASING, fill: "forwards" }),
      node.animate(transform, {
        duration: CELL_TRANSITION_MS,
        easing: CELL_TRANSITION_EASING,
        fill: "forwards",
      }),
    ];
    let cancelled = false;
    // A cell that faded out keeps its end state until it is shown again, so it never flashes
    // before it is hidden. A cell that faded in returns to its normal style.
    if (fade.kind === "in") {
      animations[1].onfinish = () => {
        if (!cancelled) {
          setFade(null);
        }
      };
    }
    return () => {
      cancelled = true;
      for (const animation of animations) {
        animation.cancel();
      }
      node.style.willChange = "";
    };
  }, [fade, frameRef]);

  return { layoutRect, isMoving: motion !== null };
}
