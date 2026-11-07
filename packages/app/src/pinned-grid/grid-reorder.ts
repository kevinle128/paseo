import type { GridCellRect } from "./geometry";

// Matches the sidebar list drag threshold in draggable-list.web.tsx.
export const HEADER_DRAG_THRESHOLD_PX = 6;
export const AUTO_SCROLL_EDGE_PX = 48;
export const AUTO_SCROLL_MAX_STEP_PX = 16;

export function hasCrossedDragThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= HEADER_DRAG_THRESHOLD_PX;
}

function containsPoint(rect: GridCellRect, point: { x: number; y: number }): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * The cell index under a point in grid content coordinates. Slot `cellCount` is the add cell and
 * maps to the last cell. A point in a gap keeps the current index so the preview does not flicker.
 */
export function resolveDropIndex(input: {
  point: { x: number; y: number };
  slotRect: (index: number) => GridCellRect;
  cellCount: number;
  currentIndex: number;
}): number {
  const { point, slotRect, cellCount, currentIndex } = input;
  for (let index = 0; index <= cellCount; index += 1) {
    if (containsPoint(slotRect(index), point)) {
      return Math.min(index, cellCount - 1);
    }
  }
  return currentIndex;
}

export function moveKey(keys: string[], key: string, toIndex: number): string[] {
  const from = keys.indexOf(key);
  const target = Math.max(0, Math.min(toIndex, keys.length - 1));
  if (from === -1 || from === target) {
    return keys;
  }
  const next = keys.filter((candidate) => candidate !== key);
  next.splice(target, 0, key);
  return next;
}

/** Pixels to scroll this frame: negative near the top edge, positive near the bottom edge. */
export function resolveAutoScrollStep(input: {
  pointerY: number;
  viewportTop: number;
  viewportBottom: number;
}): number {
  const { pointerY, viewportTop, viewportBottom } = input;
  const scale = (depth: number) =>
    Math.min(
      AUTO_SCROLL_MAX_STEP_PX,
      Math.max(1, Math.ceil((depth / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_STEP_PX)),
    );
  if (pointerY < viewportTop + AUTO_SCROLL_EDGE_PX) {
    return -scale(viewportTop + AUTO_SCROLL_EDGE_PX - pointerY);
  }
  if (pointerY > viewportBottom - AUTO_SCROLL_EDGE_PX) {
    return scale(pointerY - (viewportBottom - AUTO_SCROLL_EDGE_PX));
  }
  return 0;
}

/** Keeps a preview valid when the committed keys change during a drag. */
export function rebasePreview(input: { preview: string[]; cellKeys: string[] }): string[] {
  const live = new Set(input.cellKeys);
  const kept = input.preview.filter((key) => live.has(key));
  const keptSet = new Set(kept);
  return [...kept, ...input.cellKeys.filter((key) => !keptSet.has(key))];
}

export function shouldCancelDragOnInterrupt(draggedKey: string | null): boolean {
  return draggedKey !== null;
}
