type Listener = (key: string) => void;

const listeners = new Set<Listener>();

/**
 * Asks the grid to scroll a cell into view. The route does not change when the pressed row
 * belongs to the cell that already has focus, so the scroll layer cannot learn of it any
 * other way.
 */
export function requestCellReveal(key: string): void {
  for (const listener of listeners) listener(key);
}

export function subscribeCellReveal(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * How long a smooth-reveal mark waits for its scroll. The mark is set right before the route
 * change that triggers the scroll, which lands within a few frames. A short limit keeps a later
 * sidebar click on the same cell from inheriting the smooth scroll if the scroll never ran.
 */
export const SMOOTH_REVEAL_TTL_MS = 1_500;

let smoothReveal: { key: string; expiresAt: number } | null = null;

/** Asks the next scroll to `key` to animate instead of jumping. One mark exists at a time. */
export function markSmoothReveal(key: string, now: number = Date.now()): void {
  smoothReveal = { key, expiresAt: now + SMOOTH_REVEAL_TTL_MS };
}

/**
 * True once when a live mark exists for `key`, and clears it. A mark for another key stays, so
 * an unrelated scroll does not spend it. An expired mark is dropped.
 */
export function consumeSmoothReveal(key: string, now: number = Date.now()): boolean {
  if (smoothReveal === null) return false;
  if (now >= smoothReveal.expiresAt) {
    smoothReveal = null;
    return false;
  }
  if (smoothReveal.key !== key) return false;
  smoothReveal = null;
  return true;
}
