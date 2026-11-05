import { useCallback, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import {
  focusWorkspaceCell,
  type ActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { getWorkspaceSelectionKey } from "@/screens/workspace/workspace-deck-retention";
import { INITIAL_GRID_FOCUS, reduceGridFocus } from "./grid-focus";
import { resolveGridFocusedKey } from "./grid-layout";
import { INITIAL_MAXIMIZE_STATE, reduceMaximize } from "./maximize-state";

/**
 * Focus and maximize state of the pinned grid. Both are local state that changes in the same
 * commit as the click. The route follows through `focusWorkspaceCell`, and a route change that
 * starts outside the grid (a sidebar click) is mirrored back here.
 */
export function useGridFocus(input: {
  activeKey: string | null;
  /** Every pinned workspace key, whether or not the grid shows. */
  pinnedKeys: string[];
  /** Cells of the grid that shows right now, or null in the single layout. */
  cells: ActiveWorkspaceSelection[] | null;
}) {
  const { activeKey, pinnedKeys, cells } = input;
  const [focusState, dispatchFocus] = useReducer(reduceGridFocus, INITIAL_GRID_FOCUS);
  const [maximizeState, dispatchMaximize] = useReducer(reduceMaximize, INITIAL_MAXIMIZE_STATE);
  const cellKeys = useMemo(() => (cells ? cells.map(getWorkspaceSelectionKey) : []), [cells]);

  useLayoutEffect(() => {
    if (activeKey === null) {
      return;
    }
    dispatchFocus({ type: "route-changed", key: activeKey });
    dispatchMaximize({ type: "route-changed", key: activeKey });
  }, [activeKey]);
  useLayoutEffect(() => {
    dispatchFocus({ type: "cells-changed", keys: pinnedKeys });
    dispatchMaximize({ type: "cells-changed", keys: pinnedKeys });
  }, [pinnedKeys]);

  const focusedKey = cells
    ? resolveGridFocusedKey({
        localFocusedKey: focusState.focusedKey,
        routeKey: activeKey,
        cellKeys,
      })
    : null;
  const maximizedKey =
    cells && maximizeState.maximizedKey !== null && cellKeys.includes(maximizeState.maximizedKey)
      ? maximizeState.maximizedKey
      : null;

  const focusedKeyRef = useRef<string | null>(focusedKey);
  focusedKeyRef.current = focusedKey;
  const activeKeyRef = useRef<string | null>(activeKey);
  activeKeyRef.current = activeKey;
  const gridFocusedKeyRef = useRef<string | null>(null);
  const selectionByKeyRef = useRef(new Map<string, ActiveWorkspaceSelection>());
  selectionByKeyRef.current = useMemo(
    () => new Map((cells ?? []).map((cell) => [getWorkspaceSelectionKey(cell), cell])),
    [cells],
  );

  /** Returns true when the call moved focus to the cell. */
  const focusCell = useCallback((key: string): boolean => {
    if (focusedKeyRef.current === key) {
      return false;
    }
    focusedKeyRef.current = key;
    dispatchFocus({ type: "pointer-down", key });
    const selection = selectionByKeyRef.current.get(key);
    if (selection && activeKeyRef.current !== key) {
      // Marks the route change that follows as grid-initiated, so it does not scroll.
      gridFocusedKeyRef.current = key;
      focusWorkspaceCell(selection);
    }
    return true;
  }, []);
  const toggleMaximize = useCallback(
    (key: string) => {
      focusCell(key);
      dispatchMaximize({ type: "toggle", key });
    },
    [focusCell],
  );

  useKeyboardActionHandler({
    handlerId: "workspace-grid-cell-maximize",
    actions: ["workspace.cell.maximize.toggle"] as const,
    enabled: cells !== null,
    priority: 100,
    isActive: () => true,
    handle: () => {
      const key = focusedKeyRef.current;
      if (key === null) {
        return false;
      }
      dispatchMaximize({ type: "toggle", key });
      return true;
    },
  });

  return { cellKeys, focusedKey, maximizedKey, gridFocusedKeyRef, focusCell, toggleMaximize };
}
