import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Tells fixed-position surfaces (Electron browser webviews, the fullscreen composer) that the grid
 * scrolled, so they recompute their rect the way they do on resize. The offset is never React
 * state: a re-render per scroll frame would re-render every cell.
 */
export interface GridScrollSignal {
  subscribe(listener: () => void): () => void;
  notify(): void;
  /** The scrolling grid element. Fixed-position surfaces clip themselves to its visible area. */
  setViewport(element: HTMLElement | null): void;
  getViewportRect(): GridViewportRect | null;
}

export interface GridViewportRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function createGridScrollSignal(): GridScrollSignal {
  const listeners = new Set<() => void>();
  let viewport: HTMLElement | null = null;
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify() {
      for (const listener of listeners) {
        listener();
      }
    },
    setViewport(element) {
      viewport = element;
    },
    getViewportRect() {
      if (!viewport?.isConnected) {
        return null;
      }
      const { left, top, right, bottom } = viewport.getBoundingClientRect();
      return { left, top, right, bottom };
    },
  };
}

const GridScrollSignalContext = createContext<GridScrollSignal | null>(null);

export function GridScrollSignalProvider({
  signal,
  children,
}: {
  signal: GridScrollSignal;
  children: ReactNode;
}) {
  return <GridScrollSignalContext value={signal}>{children}</GridScrollSignalContext>;
}

/** The grid's signal, or null outside a pinned grid. */
export function useGridScrollSignalSource(): GridScrollSignal | null {
  return useContext(GridScrollSignalContext);
}

/** One stable signal for the deck. */
export function useCreateGridScrollSignal(): GridScrollSignal {
  return useMemo(() => createGridScrollSignal(), []);
}
