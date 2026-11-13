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
