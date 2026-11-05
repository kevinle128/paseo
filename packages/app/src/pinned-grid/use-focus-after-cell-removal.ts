import { useLayoutEffect, useState } from "react";
import {
  focusWorkspaceCell,
  type ActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import type { PinnedGridMode } from "./preferences";
import { resolveFocusAfterCellRemoval } from "./focus-after-removal";

function containsSelection(
  cells: readonly ActiveWorkspaceSelection[],
  selection: ActiveWorkspaceSelection,
): boolean {
  return cells.some(
    (cell) => cell.serverId === selection.serverId && cell.workspaceId === selection.workspaceId,
  );
}

/**
 * Keeps the grid when the focused cell is unpinned. The deck would otherwise see an active
 * workspace that is no longer pinned and fall back to the single layout.
 *
 * The cells of the last grid whose focused cell was the active workspace are kept as state. When
 * the active workspace leaves them, the neighbor cell is returned as the active selection in the
 * same render, so the grid never drops to the single layout, and the route follows to that cell.
 * The previous cells stay until the route arrives, because a re-render before then must still
 * resolve the same neighbor.
 */
export function useFocusAfterCellRemoval(input: {
  mode: PinnedGridMode;
  /** True when the platform and viewport can host a grid. */
  supportsGrid: boolean;
  /** The workspace of the route. */
  routeSelection: ActiveWorkspaceSelection | null;
  pinnedSelections: ActiveWorkspaceSelection[];
}): ActiveWorkspaceSelection | null {
  const { mode, supportsGrid, routeSelection: activeSelection, pinnedSelections } = input;
  const enabled = supportsGrid && mode !== "normal";
  const [previousCells, setPreviousCells] = useState<ActiveWorkspaceSelection[] | null>(null);

  const neighbor =
    enabled && previousCells
      ? resolveFocusAfterCellRemoval({
          previousCells,
          nextCells: pinnedSelections,
          activeSelection,
        })
      : null;

  useLayoutEffect(() => {
    if (neighbor) {
      return;
    }
    const isFocusedCell =
      enabled && activeSelection !== null && containsSelection(pinnedSelections, activeSelection);
    setPreviousCells(isFocusedCell ? pinnedSelections : null);
  }, [activeSelection, enabled, neighbor, pinnedSelections]);

  const neighborServerId = neighbor?.serverId ?? null;
  const neighborWorkspaceId = neighbor?.workspaceId ?? null;
  useLayoutEffect(() => {
    if (neighborServerId !== null && neighborWorkspaceId !== null) {
      focusWorkspaceCell({ serverId: neighborServerId, workspaceId: neighborWorkspaceId });
    }
  }, [neighborServerId, neighborWorkspaceId]);

  return neighbor ?? activeSelection;
}
