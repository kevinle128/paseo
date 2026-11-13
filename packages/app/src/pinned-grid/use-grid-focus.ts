import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import { isWeb } from "@/constants/platform";
import { getDesktopHost } from "@/desktop/host";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";
import { hasActiveOverlay } from "@/keyboard";
import type { KeyboardActionId } from "@/keyboard/keyboard-action-dispatcher";
import {
  focusWorkspaceCell,
  type ActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { getWorkspaceSelectionKey } from "@/screens/workspace/workspace-deck-retention";
import { requestCellReveal } from "./cell-reveal-request";
import { cancelComposerFocusRequest, requestComposerFocus } from "./composer-focus-request";
import { focusGridCellFrame } from "./grid-cell-frame";
import { INITIAL_GRID_FOCUS, reduceGridFocus } from "./grid-focus";
import { resolveGridFocusedKey } from "./grid-layout";
import { resolveGridNeighbor, type GridDirection } from "./grid-navigation";
import { INITIAL_MAXIMIZE_STATE, reduceMaximize } from "./maximize-state";

const FOCUS_ACTION_DIRECTIONS: Partial<Record<KeyboardActionId, GridDirection>> = {
  "workspace.cell.focus.left": "left",
  "workspace.cell.focus.right": "right",
  "workspace.cell.focus.up": "up",
  "workspace.cell.focus.down": "down",
};

// Controls that use Enter themselves. A key pressed while one has DOM focus belongs to it, so the
// grid shortcuts leave it alone.
const ENTER_OWNING_CONTROL_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "[contenteditable]",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="slider"]',
].join(",");

// Controls that move with the arrow keys themselves. Buttons, links and switches do not, so after
// a click on a header button the arrows still move between cells.
const ARROW_OWNING_CONTROL_SELECTOR = [
  "input",
  "select",
  "textarea",
  "[contenteditable]",
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="slider"]',
].join(",");

const COMPOSER_SELECTOR = "[data-testid='message-input-root']";

/** True when DOM focus is in a composer, the one text surface where the move keys act. */
function isFocusInComposer(): boolean {
  if (!isWeb || typeof document === "undefined") {
    return false;
  }
  const active = document.activeElement;
  return active instanceof Element && active.closest(COMPOSER_SELECTOR) !== null;
}

/** True when the plain Enter or arrow key is free for grid navigation. */
function isKeyFreeForGridNavigation(key: "arrow" | "enter"): boolean {
  if (!isWeb || typeof document === "undefined") {
    return false;
  }
  const selector = key === "arrow" ? ARROW_OWNING_CONTROL_SELECTOR : ENTER_OWNING_CONTROL_SELECTOR;
  const active = document.activeElement;
  return !(active instanceof Element) || !active.closest(selector);
}

/**
 * Focus and maximize state of the pinned grid. Both are local state that changes in the same
 * commit as the click. The route follows through `focusWorkspaceCell`, and a route change that
 * starts outside the grid (a sidebar click) is mirrored back here.
 */
export function useGridFocus(input: {
  activeKey: string | null;
  /** Every pinned workspace key, whether or not the grid shows. */
  pinnedKeys: string[];
  /** The grid that shows right now, or null in the single layout. */
  grid: { cells: ActiveWorkspaceSelection[]; columns: number } | null;
}) {
  const { activeKey, pinnedKeys, grid } = input;
  const cells = grid ? grid.cells : null;
  const columns = grid ? grid.columns : null;
  const keyboardActionDispatcher = useKeyboardActionDispatcher();
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

  // Cmd/Ctrl +, = and - share keys with window zoom. The handler claims them for the whole time a
  // grid shows, even when there is nothing to do, so plain web never zooms the page under a grid.
  useKeyboardActionHandler({
    handlerId: "workspace-grid-cell-maximize-keys",
    actions: ["workspace.cell.maximize.set", "workspace.cell.maximize.restore"] as const,
    enabled: cells !== null,
    priority: 100,
    isActive: () => true,
    handle: (action) => {
      const key = focusedKeyRef.current;
      if (action.id === "workspace.cell.maximize.restore") {
        dispatchMaximize({ type: "restore" });
      } else if (key !== null) {
        dispatchMaximize({ type: "maximize", key });
      }
      return true;
    },
  });

  const cellKeysRef = useRef(cellKeys);
  cellKeysRef.current = cellKeys;
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const maximizedKeyRef = useRef(maximizedKey);
  maximizedKeyRef.current = maximizedKey;

  useKeyboardActionHandler({
    handlerId: "workspace-grid-cell-focus-move",
    actions: [
      "workspace.cell.focus.left",
      "workspace.cell.focus.right",
      "workspace.cell.focus.up",
      "workspace.cell.focus.down",
    ] as const,
    enabled: cells !== null,
    priority: 100,
    isActive: () => true,
    handle: (action) => {
      const direction = FOCUS_ACTION_DIRECTIONS[action.id];
      const key = focusedKeyRef.current;
      const gridColumns = columnsRef.current;
      // A maximized cell has no neighbor on screen, and the keys then keep their normal meaning.
      if (!direction || key === null || gridColumns === null || maximizedKeyRef.current !== null) {
        return false;
      }
      // The composer is the one text surface where the keys act, so the user can switch cells
      // while typing. Any other control that moves with the arrows keeps them.
      const fromComposer = isFocusInComposer();
      if (hasActiveOverlay() || (!fromComposer && !isKeyFreeForGridNavigation("arrow"))) {
        return false;
      }
      const keys = cellKeysRef.current;
      const nextIndex = resolveGridNeighbor({
        count: keys.length,
        columns: gridColumns,
        index: keys.indexOf(key),
        direction,
      });
      const nextKey = nextIndex === null ? undefined : keys[nextIndex];
      if (nextKey === undefined) {
        return false;
      }
      focusCell(nextKey);
      requestCellReveal(nextKey);
      focusGridCellFrame(nextKey);
      // The draft of the cell left behind stays in the draft store. The new cell is not focused
      // yet, so its composer takes the request when it becomes active.
      if (fromComposer) {
        requestComposerFocus();
      } else {
        cancelComposerFocusRequest();
      }
      return true;
    },
  });

  // Enter shares its binding slot with dictation confirm, which comes later in the binding table.
  // When the grid does not act, the key goes on to dictation confirm, so Normal mode is unchanged.
  // An open overlay owns the key, so the grid does not act, but dictation confirm stays as before.
  useKeyboardActionHandler({
    handlerId: "workspace-grid-cell-composer-focus",
    actions: ["workspace.cell.composer.focus"] as const,
    enabled: true,
    priority: 100,
    isActive: () => true,
    handle: () => {
      if (
        columnsRef.current !== null &&
        focusedKeyRef.current !== null &&
        !hasActiveOverlay() &&
        isKeyFreeForGridNavigation("enter") &&
        keyboardActionDispatcher.dispatch({ id: "message-input.focus", scope: "message-input" })
      ) {
        return true;
      }
      return keyboardActionDispatcher.dispatch({
        id: "message-input.dictation-confirm",
        scope: "message-input",
      });
    },
  });

  // While a grid shows, window zoom must not take Cmd/Ctrl +, = and -. Electron disables its zoom
  // menu items; plain web is covered by the handler above claiming the keys.
  const gridShows = cells !== null;
  useEffect(() => {
    if (!gridShows) {
      return undefined;
    }
    const menu = getDesktopHost()?.menu;
    void menu?.setGridZoomKeys?.(true);
    return () => {
      void menu?.setGridZoomKeys?.(false);
    };
  }, [gridShows]);

  return { cellKeys, focusedKey, maximizedKey, gridFocusedKeyRef, focusCell, toggleMaximize };
}
