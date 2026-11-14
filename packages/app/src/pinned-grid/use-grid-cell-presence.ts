import { useMemo } from "react";
import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import {
  getWorkspaceSelectionKey,
  type GridCellRetentionState,
} from "@/screens/workspace/workspace-deck-retention";
import type { GridCellRect, GridGeometry } from "./geometry";
import type { GridScrollSignal } from "./grid-scroll-signal";
import { useCellPresences } from "./use-cell-presences";

const NO_CELL_RECTS: GridCellRect[] = [];

/**
 * Presence of each grid cell plus what the retention cap needs to know about it. The cap states
 * are undefined while no grid shows.
 */
export function useGridCellPresence(input: {
  signal: GridScrollSignal;
  cells: ActiveWorkspaceSelection[] | null;
  geometry: GridGeometry | null;
  viewportHeight: number;
  cellIndexByKey: ReadonlyMap<string, number>;
  focusedKey: string | null;
  maximizedKey: string | null;
}) {
  const { cells, geometry, cellIndexByKey, focusedKey, maximizedKey } = input;
  const focusedIndex = focusedKey === null ? -1 : (cellIndexByKey.get(focusedKey) ?? -1);
  const maximizedIndex = maximizedKey === null ? null : (cellIndexByKey.get(maximizedKey) ?? null);
  const rects = useMemo(
    () => (cells && geometry ? cells.map((_, index) => geometry.cellRect(index)) : NO_CELL_RECTS),
    [cells, geometry],
  );
  const snapshot = useCellPresences({
    signal: input.signal,
    enabled: cells !== null && geometry !== null,
    rects,
    viewportHeight: input.viewportHeight,
    focusedIndex,
    maximizedIndex,
  });
  const gridCellStates = useMemo(() => {
    if (!cells) {
      return undefined;
    }
    const states = new Map<string, GridCellRetentionState>();
    for (const [index, cell] of cells.entries()) {
      const presence = snapshot.presences[index];
      if (presence) {
        states.set(getWorkspaceSelectionKey(cell), {
          presence,
          distancePx: snapshot.distances[index] ?? 0,
        });
      }
    }
    return states;
  }, [cells, snapshot]);
  return { presences: snapshot.presences, gridCellStates };
}
