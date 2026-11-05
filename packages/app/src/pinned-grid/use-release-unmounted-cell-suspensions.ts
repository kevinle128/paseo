import { useEffect, useRef } from "react";
import { useSessionStore } from "@/stores/session-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

interface CellRef {
  serverId: string;
  workspaceId: string;
}

function cellKey(cell: CellRef): string {
  return `${cell.serverId}:${cell.workspaceId}`;
}

/**
 * Grid cells that have no mounted workspace. Such a cell may still hold a timeline suspension
 * from the moment its workspace unmounted while hidden, and nothing mounted can release it.
 */
export function selectUnmountedCells(
  cells: readonly CellRef[] | null,
  mountedKeys: ReadonlySet<string>,
): CellRef[] {
  return (cells ?? []).filter((cell) => !mountedKeys.has(cellKey(cell)));
}

/** Cells that held a suspension without a mounted workspace and no longer do so. */
export function selectReleasedCells(
  previous: readonly CellRef[],
  current: readonly CellRef[],
  mountedKeys: ReadonlySet<string>,
): CellRef[] {
  const currentKeys = new Set(current.map(cellKey));
  return previous.filter((cell) => {
    const key = cellKey(cell);
    return !currentKeys.has(key) && !mountedKeys.has(key);
  });
}

function resumeCell(cell: CellRef): void {
  const sourceId = buildWorkspaceTabPersistenceKey(cell);
  const sync = useSessionStore.getState().sessions[cell.serverId]?.viewedTimelineSync;
  if (sourceId && sync) {
    sync.resumeSource(sourceId);
  }
}

/**
 * A hidden cell whose workspace unmounts stays suspended: its dormant card needs no stream. That
 * suspension must end when the cell leaves the grid (unpinned, grid closed) or the deck goes away,
 * and a workspace that mounts again manages its own. `resumeSource` does nothing for a source that
 * is not suspended.
 */
export function useReleaseUnmountedCellSuspensions(input: {
  unmountedCells: readonly CellRef[];
  mountedKeys: ReadonlySet<string>;
}): void {
  const { unmountedCells, mountedKeys } = input;
  const heldRef = useRef<readonly CellRef[]>([]);

  useEffect(() => {
    const held = heldRef.current;
    heldRef.current = unmountedCells;
    // A cell that left the unmounted set either mounted (it releases itself) or left the grid.
    selectReleasedCells(held, unmountedCells, mountedKeys).forEach(resumeCell);
  }, [mountedKeys, unmountedCells]);

  useEffect(
    () => () => {
      heldRef.current.forEach(resumeCell);
      heldRef.current = [];
    },
    [],
  );
}
