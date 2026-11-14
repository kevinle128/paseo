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

/** A transform written in one fixed form, so the browser interpolates each part on its own. */
function formatFlipTransform(dx: number, dy: number, sx: number, sy: number): string {
  return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
}

const IDENTITY_TRANSFORM = formatFlipTransform(0, 0, 1, 1);

/**
 * The transform that draws a box laid out at `layout` over the rect `from`. It assumes
 * `transform-origin: 0 0`.
 */
export function buildFlipTransform(from: GridCellRect, layout: GridCellRect): string {
  const sx = layout.width > 0 ? from.width / layout.width : 1;
  const sy = layout.height > 0 ? from.height / layout.height : 1;
  return formatFlipTransform(from.x - layout.x, from.y - layout.y, sx, sy);
}

/** Keyframes that move a box laid out at `layout` from the rect `from` to where it is laid out. */
export function buildFlipKeyframes(from: GridCellRect, layout: GridCellRect): Keyframe[] {
  return [{ transform: buildFlipTransform(from, layout) }, { transform: IDENTITY_TRANSFORM }];
}

/**
 * Keyframes for a cell that fills the grid. The cell is laid out at its final rect once and only a
 * transform moves it, so the animation runs on the compositor. `fromScrollTop` is the grid scroll
 * offset before maximize; the grid scrolls to the top then, so the slot was drawn that much higher.
 */
export function buildMaximizeKeyframes(input: {
  from: GridCellRect;
  to: GridCellRect;
  fromScrollTop: number;
}): Keyframe[] {
  const { from, to, fromScrollTop } = input;
  return buildFlipKeyframes({ ...from, y: from.y - fromScrollTop }, to);
}

/**
 * Keyframes for a cell that returns to its slot. The cell is laid out at the slot at once and
 * starts drawn over the whole viewport. The grid scrolls back to `toScrollTop` in the same frame,
 * so the viewport top is at `toScrollTop` in grid coordinates.
 */
export function buildRestoreKeyframes(input: {
  maximized: GridCellRect;
  slot: GridCellRect;
  toScrollTop: number;
}): Keyframe[] {
  const { maximized, slot, toScrollTop } = input;
  return buildFlipKeyframes({ ...maximized, y: maximized.y + toScrollTop }, slot);
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
