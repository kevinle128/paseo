import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { View } from "react-native";
import { isNative } from "@/constants/platform";
import { BROWSER_SURFACES_HELD_ATTRIBUTE } from "@/desktop/browser/resident-webviews";
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
import type { GridScrollSignal } from "./grid-scroll-signal";

/**
 * The cell is laid out once at its final rect and only a transform moves it (maximize, restore),
 * or opacity and a transform (the other cells). Both run on the compositor, so main-thread work
 * during the motion does not drop frames and no workspace relayouts while it moves.
 * `from` is the layout rect before the change.
 */
type CellMotion =
  | { kind: "maximize"; from: GridCellRect; scrollTop: number }
  | { kind: "restore"; from: GridCellRect };

type CellFade = { kind: "out"; scrollTop: number } | { kind: "in" };

/**
 * Drives the maximize and restore motion of one cell frame, and the fade of the cells around it.
 * Returns the rect the frame lays out at.
 */
export function useCellMotion(input: {
  frameRef: RefObject<View | null>;
  /**
   * Source of the grid scroll offset. Reading `scrollTop` from the DOM during render would force
   * a layout of the whole grid before the commit, and the commit lays it out again.
   */
  scrollSignal: GridScrollSignal | null;
  isCell: boolean;
  isVisible: boolean;
  rect: GridCellRect | null;
  isMaximized: boolean;
  underMaximized: boolean;
}): { layoutRect: GridCellRect | null; isMoving: boolean } {
  const { frameRef, scrollSignal, isCell, isVisible, rect, isMaximized, underMaximized } = input;
  const readScrollTop = () => scrollSignal?.getScrollTop() ?? 0;
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
        scrollTop: readScrollTop(),
      });
    } else {
      setMotion({ kind: "restore", from: previous });
    }
  }
  if (seenUnder !== underMaximized) {
    setSeenUnder(underMaximized);
    if (!canAnimate) {
      setFade(null);
    } else if (underMaximized) {
      setFade(isVisible ? { kind: "out", scrollTop: readScrollTop() } : null);
    } else {
      setFade(isVisible ? { kind: "in" } : null);
    }
  }
  // A restore lays the cell out at its slot at once and scales it down from the viewport. Holding
  // the large layout and scaling down to the slot instead would keep the content crisp during the
  // motion, but relayout the workspace at the end, where the pop is visible.
  const layoutRect = rect;
  useLayoutEffect(() => {
    lastRectRef.current = layoutRect;
  }, [layoutRect]);

  useLayoutEffect(() => {
    const node: unknown = frameRef.current;
    if (!motion || !(node instanceof HTMLElement) || !layoutRect) {
      return undefined;
    }
    let cancelled = false;
    let animation: Animation | null = null;
    // Set before the first measure of the new layout; the settle `layout` signal places the
    // webviews again once the motion has ended.
    node.setAttribute(BROWSER_SURFACES_HELD_ATTRIBUTE, "");
    const start = (keyframes: Keyframe[]) => {
      node.style.transformOrigin = "0 0";
      node.style.willChange = "transform";
      animation = node.animate(keyframes, {
        duration: CELL_TRANSITION_MS,
        easing: CELL_TRANSITION_EASING,
      });
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
        }),
      );
    } else {
      // The grid returns to the offset the signal keeps, in a parent layout effect after this one.
      start(
        buildRestoreKeyframes({
          maximized: motion.from,
          slot: layoutRect,
          toScrollTop: readScrollTop(),
        }),
      );
    }
    return () => {
      cancelled = true;
      animation?.cancel();
      node.removeAttribute(BROWSER_SURFACES_HELD_ATTRIBUTE);
      node.style.willChange = "";
      node.style.transformOrigin = "";
    };
    // `layoutRect` is read only when the motion starts.
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
    animations[1].onfinish = () => {
      if (cancelled) {
        return;
      }
      if (fade.kind === "in") {
        setFade(null);
      } else {
        node.style.willChange = "";
      }
    };
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
