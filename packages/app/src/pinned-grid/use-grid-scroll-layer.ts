import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { View } from "react-native";
import { consumeSmoothReveal, subscribeCellReveal } from "./cell-reveal-request";
import { prefersReducedMotion } from "./cell-transition";
import type { GridCellRect } from "./geometry";
import { resolveScrollToCell } from "./grid-layout";
import type { GridScrollSignal } from "./grid-scroll-signal";

/**
 * Scroll behavior of the grid container: it publishes scroll to fixed-position surfaces, resets to
 * the top while a cell is maximized and restores the offset after, and scrolls a cell into view
 * when focus arrives from outside the grid (a sidebar click). The scroll animates once when the
 * cell was marked with `markSmoothReveal` (a pin picked in the "+" picker).
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
    // The signal keeps the offset outside a maximize, so the maximize motion reads it without a
    // layout and the restore returns to it.
    const handleScroll = () => {
      if (!isMaximizedRef.current) {
        signal.setScrollTop(node.scrollTop);
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
    node.scrollTop = maximizedKey !== null ? 0 : signal.getScrollTop();
  }, [deckRef, isGrid, maximizedKey, signal]);

  const scrollCellIntoView = useCallback(
    (key: string) => {
      const node: unknown = deckRef.current;
      if (!(node instanceof HTMLElement)) return;
      const rect = cellRectsRef.current.get(key);
      if (!rect) return;
      // Spent before the target is known, so a mark for a cell already in view does not carry
      // over to a later scroll to the same cell.
      const smooth = consumeSmoothReveal(key) && !prefersReducedMotion();
      const target = resolveScrollToCell({
        cellTop: rect.y,
        cellHeight: rect.height,
        scrollTop: node.scrollTop,
        viewportHeight: viewportHeightRef.current,
      });
      if (target === null) return;
      if (smooth) {
        node.scrollTo({ top: target, behavior: "smooth" });
      } else {
        node.scrollTop = target;
      }
    },
    [deckRef],
  );

  useEffect(() => {
    if (!isGrid) return undefined;
    return subscribeCellReveal((key) => {
      if (!isMaximizedRef.current) scrollCellIntoView(key);
    });
  }, [isGrid, scrollCellIntoView]);

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
    scrollCellIntoView(activeKey);
  }, [activeKey, deckRef, gridFocusedKeyRef, isGrid, scrollCellIntoView]);
}
