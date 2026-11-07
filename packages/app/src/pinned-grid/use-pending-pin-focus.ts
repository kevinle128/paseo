import { useCallback, useEffect, useReducer, useRef } from "react";
import { focusWorkspaceCell } from "@/stores/navigation-active-workspace-store";
import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { getWorkspaceSelectionKey } from "@/screens/workspace/workspace-deck-retention";
import {
  reducePendingPinFocus,
  type PendingPinFocusEvent,
  type PendingPinFocusResult,
} from "./pending-pin-focus";

const NO_PENDING_PIN: PendingPinFocusResult = { state: null };

function reduceResult(
  current: PendingPinFocusResult,
  event: PendingPinFocusEvent,
): PendingPinFocusResult {
  return reducePendingPinFocus(current.state, event);
}

/**
 * Focuses the workspace a user picked in the "+" picker once its pin shows up in the pinned
 * list. Any focus change by the user, or a different active workspace, drops the request, so a
 * late pin never pulls focus away from where the user went.
 */
export function usePendingPinFocus(input: {
  activeKey: string | null;
  pinnedKeys: readonly string[];
  pinnedSelections: ActiveWorkspaceSelection[];
  /** Moves grid focus to a cell. Returns true when focus moved. */
  focusCellInGrid: (key: string) => boolean;
}) {
  const { activeKey, pinnedKeys, pinnedSelections, focusCellInGrid } = input;
  const [pending, dispatch] = useReducer(reduceResult, NO_PENDING_PIN);
  const pendingKey = pending.state?.key ?? null;

  const handlePicked = useCallback(
    (key: string) => dispatch({ type: "picked", key, now: Date.now() }),
    [],
  );
  const focusCell = useCallback(
    (key: string): boolean => {
      dispatch({ type: "user-focus" });
      return focusCellInGrid(key);
    },
    [focusCellInGrid],
  );

  const pendingKeyRef = useRef(pendingKey);
  useEffect(() => {
    pendingKeyRef.current = pendingKey;
  });
  useEffect(() => {
    if (pendingKeyRef.current !== null && activeKey !== pendingKeyRef.current) {
      dispatch({ type: "user-focus" });
    }
  }, [activeKey]);
  useEffect(() => {
    if (pendingKey !== null) {
      dispatch({ type: "pins-changed", pinnedKeys, now: Date.now() });
    }
  }, [pendingKey, pinnedKeys]);

  const selectionsRef = useRef(pinnedSelections);
  useEffect(() => {
    selectionsRef.current = pinnedSelections;
  });
  // Runs once per reducer result, so a focus request is never replayed by an unrelated render.
  useEffect(() => {
    if (pending.focus === undefined) {
      return;
    }
    const selection = selectionsRef.current.find(
      (candidate) => getWorkspaceSelectionKey(candidate) === pending.focus,
    );
    if (selection) {
      focusWorkspaceCell(selection);
    }
  }, [pending]);

  return { handlePicked, focusCell };
}
