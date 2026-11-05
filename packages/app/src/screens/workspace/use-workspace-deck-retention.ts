import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isNative } from "@/constants/platform";
import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import {
  areRetainedWorkspaceSelectionListsEqual,
  areWorkspaceSelectionsEqual,
  getNextWorkspaceDeckExpirationDelay,
  orderWorkspaceSelectionsForStableRender,
  reconcileRetainedWorkspaceSelections,
  resolveWorkspaceDeckEntries,
  resolveWorkspaceDeckRetentionLimit,
  type GridCellRetentionState,
  type RetainedWorkspaceSelection,
} from "./workspace-deck-retention";

/**
 * The workspaces the deck keeps mounted: the active one, the pinned grid cells and recently visited
 * workspaces until they expire. Grid cells above the cap lose their mount, `hidden` ones first.
 */
export function useWorkspaceDeckRetention(input: {
  activeSelection: ActiveWorkspaceSelection | null;
  pinnedForRetention: ActiveWorkspaceSelection[];
  gridCellStates: ReadonlyMap<string, GridCellRetentionState> | undefined;
}) {
  const { activeSelection, pinnedForRetention, gridCellStates } = input;
  const pinnedForRetentionRef = useRef(pinnedForRetention);
  pinnedForRetentionRef.current = pinnedForRetention;

  const [retainedSelections, setRetainedSelections] = useState<RetainedWorkspaceSelection[]>(() =>
    activeSelection ? [{ selection: activeSelection, inactiveSince: null }] : [],
  );
  const gridCellStatesRef = useRef(gridCellStates);
  gridCellStatesRef.current = gridCellStates;
  const unmountWorkspaceSelection = useCallback((selection: ActiveWorkspaceSelection) => {
    setRetainedSelections((current) =>
      current.filter((entry) => !areWorkspaceSelectionsEqual(entry.selection, selection)),
    );
  }, []);

  const reconciliationNow = Date.now();
  const nextRetainedSelections = useMemo(
    () =>
      reconcileRetainedWorkspaceSelections({
        currentEntries: retainedSelections,
        activeSelection,
        now: reconciliationNow,
        maxMountedWorkspaces: resolveWorkspaceDeckRetentionLimit({ isNative }),
        pinnedSelections: pinnedForRetention,
        gridCellStates,
      }),
    [activeSelection, gridCellStates, pinnedForRetention, reconciliationNow, retainedSelections],
  );
  const renderedSelections = useMemo(
    () =>
      orderWorkspaceSelectionsForStableRender(
        nextRetainedSelections.map((entry) => entry.selection),
      ),
    [nextRetainedSelections],
  );
  const renderedEntries = useMemo(
    () => resolveWorkspaceDeckEntries({ selections: renderedSelections, activeSelection }),
    [activeSelection, renderedSelections],
  );

  useLayoutEffect(() => {
    if (!areRetainedWorkspaceSelectionListsEqual(retainedSelections, nextRetainedSelections)) {
      setRetainedSelections(nextRetainedSelections);
    }
  }, [nextRetainedSelections, retainedSelections]);

  useEffect(() => {
    const expirationDelay = getNextWorkspaceDeckExpirationDelay({
      entries: nextRetainedSelections,
      activeSelection,
      now: reconciliationNow,
    });
    if (expirationDelay === null) {
      return;
    }
    const timeout = setTimeout(() => {
      setRetainedSelections((current) =>
        reconcileRetainedWorkspaceSelections({
          currentEntries: current,
          activeSelection,
          now: Date.now(),
          maxMountedWorkspaces: resolveWorkspaceDeckRetentionLimit({ isNative }),
          pinnedSelections: pinnedForRetentionRef.current,
          gridCellStates: gridCellStatesRef.current,
        }),
      );
    }, expirationDelay + 1);
    return () => clearTimeout(timeout);
  }, [activeSelection, nextRetainedSelections, reconciliationNow]);

  return { renderedSelections, renderedEntries, unmountWorkspaceSelection };
}
