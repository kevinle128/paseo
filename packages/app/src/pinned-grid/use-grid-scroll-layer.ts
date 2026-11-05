import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { View } from "react-native";
import type { GridCellRect } from "./geometry";
import { resolveScrollToCell } from "./grid-layout";
import type { GridScrollSignal } from "./grid-scroll-signal";

/**
 * Scroll behavior of the grid container: it publishes scroll to fixed-position surfaces, resets to
 * the top while a cell is maximized and restores the offset after, and scrolls a cell into view
 * when focus arrives from outside the grid (a sidebar click).
 */
export function useGridScrollLayer(input: {
  deckRef: RefObject<View | null>;
  isGrid: boolean;
  maximizedKey: string | null;
  activeKey: string | null;
  /** Key the grid itself just focused; a pointer focus never needs a scroll. */
  gridFocusedKeyRef: RefObject<string | null>;
  cellRects: Map<string, GridCellRect>;
  viewportHeight: number;
  signal: GridScrollSignal;
}) {
  const {
    deckRef,
    isGrid,
    maximizedKey,
    activeKey,
    gridFocusedKeyRef,
    cellRects,
    viewportHeight,
    signal,
  } = input;
  const savedScrollTopRef = useRef(0);
  const isMaximizedRef = useRef(false);
  isMaximizedRef.current = maximizedKey !== null;
  const cellRectsRef = useRef(cellRects);
  cellRectsRef.current = cellRects;
  const viewportHeightRef = useRef(viewportHeight);
  viewportHeightRef.current = viewportHeight;

  useEffect(() => {
    const node: unknown = deckRef.current;
    if (!isGrid || !(node instanceof HTMLElement)) {
      return undefined;
    }
    const handleScroll = () => {
      if (!isMaximizedRef.current) {
        savedScrollTopRef.current = node.scrollTop;
      }
      signal.notify();
    };
    node.addEventListener("scroll", handleScroll, { passive: true });
    signal.setViewport(node);
    return () => {
      node.removeEventListener("scroll", handleScroll);
      signal.setViewport(null);
    };
  }, [deckRef, isGrid, signal]);

  useLayoutEffect(() => {
    const node: unknown = deckRef.current;
    if (!isGrid || !(node instanceof HTMLElement)) {
      return;
    }
    node.scrollTop = maximizedKey !== null ? 0 : savedScrollTopRef.current;
  }, [deckRef, isGrid, maximizedKey]);

  useEffect(() => {
    const node: unknown = deckRef.current;
    if (!isGrid || isMaximizedRef.current || activeKey === null || !(node instanceof HTMLElement)) {
      return;
    }
    // The grid itself moved focus here, so the cell is already under the pointer. The mark is
    // consumed so a later sidebar click on the same cell scrolls to it again.
    if (gridFocusedKeyRef.current === activeKey) {
      gridFocusedKeyRef.current = null;
      return;
    }
    const rect = cellRectsRef.current.get(activeKey);
    if (!rect) {
      return;
    }
    const target = resolveScrollToCell({
      cellTop: rect.y,
      cellHeight: rect.height,
      scrollTop: node.scrollTop,
      viewportHeight: viewportHeightRef.current,
    });
    if (target !== null) {
      node.scrollTop = target;
    }
  }, [activeKey, deckRef, gridFocusedKeyRef, isGrid]);
}
