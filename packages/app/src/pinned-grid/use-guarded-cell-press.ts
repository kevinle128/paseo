import { useCallback } from "react";
import { shouldRunGuardedPress } from "./cell-press-guard";
import { useWorkspaceGridCell } from "./grid-cell-context";

/**
 * Wraps the press handler of a consequential control (permission Allow and Deny, plan approval).
 * In a grid cell that was not focused when the press began, the press only focuses the cell and
 * the next press acts. Outside the grid the handler runs unchanged.
 */
export function useGuardedCellPress<Args extends unknown[]>(
  onPress: (...args: Args) => void,
): (...args: Args) => void {
  const cell = useWorkspaceGridCell();
  return useCallback(
    (...args: Args) => {
      const shouldRun = shouldRunGuardedPress({
        inGridCell: cell !== null,
        cellIsFocused: cell?.isFocused ?? true,
        pointerFocusedCell: cell?.pointerFocusClaim.isClaimed() ?? false,
      });
      if (shouldRun) {
        onPress(...args);
        return;
      }
      if (cell && !cell.isFocused) {
        cell.focusCell();
      }
    },
    [cell, onPress],
  );
}
