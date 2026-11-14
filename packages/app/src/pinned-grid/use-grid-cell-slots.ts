import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { View } from "react-native";
import { getWorkspaceSelectionKey } from "@/screens/workspace/workspace-deck-retention";
import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { hasVisibleOrderChanged, mergeWithRemainder } from "@/utils/sidebar-reorder";
import { CELL_TRANSITION_SETTLE_MS, prefersReducedMotion } from "./cell-transition";
import type { GridCellRect, GridGeometry } from "./geometry";
import { resolveGridSlots } from "./grid-layout";
import type { GridScrollSignal } from "./grid-scroll-signal";
import { useGridReorderDrag } from "./use-grid-reorder-drag";

const EMPTY_RECT: GridCellRect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Where each cell sits, including the preview of a header drag. A preview changes slot
 * assignment only: the dragged cell keeps its committed rect (the drag moves it with a
 * transform) and the committed cell order stays what the rest of the deck reads. A drop writes
 * the merged order once.
 */
export function useGridCellSlots(input: {
  deckRef: RefObject<View | null>;
  signal: GridScrollSignal;
  grid: { cells: ActiveWorkspaceSelection[] } | null;
  geometry: GridGeometry | null;
  cellKeys: string[];
  maximizedKey: string | null;
  viewport: { width: number; height: number };
  onDragStart: (key: string) => void;
}) {
  const { deckRef, signal, grid, geometry, cellKeys, maximizedKey, viewport, onDragStart } = input;
  const [previewOrder, setPreviewOrder] = useState<string[] | null>(null);

  const slotRect = useCallback(
    (index: number): GridCellRect => geometry?.cellRect(index) ?? EMPTY_RECT,
    [geometry],
  );
  const onCommit = useCallback((order: string[]) => {
    const store = useSidebarOrderStore.getState();
    const merge = { currentOrder: store.getPinnedWorkspaceOrder(), reorderedVisibleKeys: order };
    if (hasVisibleOrderChanged(merge)) {
      store.setPinnedWorkspaceOrder(mergeWithRemainder(merge));
    }
  }, []);
  const onFrame = useCallback(() => signal.notify("layout"), [signal]);
  const { beginHeaderDrag, draggedKey } = useGridReorderDrag({
    deckRef,
    enabled: grid !== null && maximizedKey === null && cellKeys.length > 1,
    cellKeys,
    slotRect,
    onDragStart,
    onPreview: setPreviewOrder,
    onCommit,
    onFrame,
  });
  const { slotIndexByKey, dropSlotIndex } = useMemo(
    () => resolveGridSlots({ cellKeys, previewOrder, draggedKey }),
    [cellKeys, draggedKey, previewOrder],
  );
  // Electron fixed surfaces (browser panes) follow a cell to its new slot.
  useEffect(() => {
    signal.notify("layout");
  }, [signal, slotIndexByKey, cellKeys]);

  // The maximized cell is laid out at its final rect at once and a transform animates it. Fixed
  // surfaces are placed again when the animation starts and once more when it ends.
  const seenMaximizedKeyRef = useRef(maximizedKey);
  const hasGrid = grid !== null;
  useEffect(() => {
    if (seenMaximizedKeyRef.current === maximizedKey) {
      return undefined;
    }
    seenMaximizedKeyRef.current = maximizedKey;
    if (!hasGrid) {
      return undefined;
    }
    signal.notify("layout");
    if (prefersReducedMotion()) {
      return undefined;
    }
    const timer = setTimeout(() => signal.notify("layout"), CELL_TRANSITION_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [hasGrid, maximizedKey, signal]);

  const cellRects = useMemo(() => {
    const rects = new Map<string, GridCellRect>();
    if (!grid || !geometry) {
      return rects;
    }
    const maximizedRect = { x: 0, y: 0, width: viewport.width, height: viewport.height };
    grid.cells.forEach((cell, committedIndex) => {
      const key = getWorkspaceSelectionKey(cell);
      const index =
        key === draggedKey ? committedIndex : (slotIndexByKey.get(key) ?? committedIndex);
      rects.set(key, key === maximizedKey ? maximizedRect : geometry.cellRect(index));
    });
    return rects;
  }, [draggedKey, geometry, grid, maximizedKey, slotIndexByKey, viewport.height, viewport.width]);

  return { cellRects, slotIndexByKey, dropSlotIndex, draggedKey, beginHeaderDrag };
}
