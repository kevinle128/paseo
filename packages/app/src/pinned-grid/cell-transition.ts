import type { GridCellRect } from "./geometry";

/** Maximize and restore take this long. The other cells fade over the same time. */
export const CELL_TRANSITION_MS = 240;
export const CELL_TRANSITION_EASING = "cubic-bezier(.2, .8, .2, 1)";
export const CELL_FADE_MS = 200;
export const CELL_FADE_EASING = "ease";
/** The other cells shrink to this scale while they fade out, and grow from it when they return. */
export const CELL_FADE_SCALE = 0.97;
/** Time to keep a fading cell on screen: the longest animation plus a frame of margin. */
export const CELL_TRANSITION_SETTLE_MS = CELL_TRANSITION_MS + 60;

export interface ClipInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** How far `inner` sits inside `outer` on each side. A side where `inner` pokes out gives 0. */
export function resolveClipInsets(outer: GridCellRect, inner: GridCellRect): ClipInsets {
  return {
    top: Math.max(0, inner.y - outer.y),
    right: Math.max(0, outer.x + outer.width - (inner.x + inner.width)),
    bottom: Math.max(0, outer.y + outer.height - (inner.y + inner.height)),
    left: Math.max(0, inner.x - outer.x),
  };
}

export function formatClipInset(insets: ClipInsets, radius: number): string {
  const { top, right, bottom, left } = insets;
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${radius}px)`;
}

const NO_INSETS: ClipInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Keyframes for a cell that fills the grid. The cell is laid out at its final rect once; the clip
 * grows from the old rect to the whole cell, so nothing relayouts while it moves.
 * `fromScrollTop` is the grid scroll offset before maximize; the grid scrolls to the top then.
 */
export function buildMaximizeKeyframes(input: {
  from: GridCellRect;
  to: GridCellRect;
  fromScrollTop: number;
  radius: number;
}): Keyframe[] {
  const { from, to, fromScrollTop, radius } = input;
  const visibleFrom = { ...from, y: from.y - fromScrollTop };
  return [
    { clipPath: formatClipInset(resolveClipInsets(to, visibleFrom), radius) },
    { clipPath: formatClipInset(NO_INSETS, radius) },
  ];
}

/**
 * Keyframes for a cell that returns to its slot. The cell keeps its large layout while the clip
 * shrinks to the slot. The grid scrolls back to `toScrollTop` at the same time, so the large
 * layout moves with a constant translate to stay on the visible area.
 */
export function buildRestoreKeyframes(input: {
  held: GridCellRect;
  target: GridCellRect;
  toScrollTop: number;
  radius: number;
}): Keyframe[] {
  const { held, target, toScrollTop, radius } = input;
  const shifted = { ...held, y: held.y + toScrollTop };
  const transform = `translateY(${toScrollTop}px)`;
  return [
    { clipPath: formatClipInset(NO_INSETS, radius), transform },
    { clipPath: formatClipInset(resolveClipInsets(shifted, target), radius), transform },
  ];
}

/**
 * Opacity keyframes and transform keyframes of the other cells. They are separate because the
 * opacity ends sooner than the movement. `offsetY` cancels a grid scroll reset that happens when a
 * cell is maximized, so a fading cell stays where it was on screen.
 */
export function buildFadeKeyframes(input: { direction: "out" | "in"; offsetY: number }): {
  opacity: Keyframe[];
  transform: Keyframe[];
} {
  const { direction, offsetY } = input;
  const at = (scale: number) => `translateY(${offsetY}px) scale(${scale})`;
  const visible = { opacity: 1, transform: at(1) };
  const hidden = { opacity: 0, transform: at(CELL_FADE_SCALE) };
  const [start, end] = direction === "out" ? [visible, hidden] : [hidden, visible];
  return {
    opacity: [{ opacity: start.opacity }, { opacity: end.opacity }],
    transform: [{ transform: start.transform }, { transform: end.transform }],
  };
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
