import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import { RetainedPanel } from "@/components/retained-panel";
import {
  type ActiveWorkspaceSelection,
  useActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { WindowChromeRegion } from "@/utils/desktop-window";
import { useHasHydratedWorkspaces, useWorkspaceExists } from "@/stores/session-store-hooks";
import { useSessionStore } from "@/stores/session-store";
import { resolveWorkspaceHeader } from "@/screens/workspace/workspace-header-source";
import { HostRouteProvider } from "@/navigation/host-route-context";
import { WorkspaceScreen } from "@/screens/workspace/workspace-screen";
import {
  isPresented,
  singlePresence,
  type WorkspacePresence,
} from "@/screens/workspace/workspace-presence";
import {
  getWorkspaceSelectionKey,
  shouldKeepWorkspaceDeckEntryMounted,
} from "@/screens/workspace/workspace-deck-retention";
import { useWorkspaceDeckRetention } from "@/screens/workspace/use-workspace-deck-retention";
import { isWeb } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import { RenderProfile } from "@/utils/render-profiler";
import { usePanelStore } from "@/stores/panel-store";
import { AddPinCell } from "@/pinned-grid/add-pin-cell";
import { GridCellFrame } from "@/pinned-grid/grid-cell-frame";
import { useFadeOutPresence } from "@/pinned-grid/use-fade-out-presence";
import { GridDropIndicator } from "@/pinned-grid/grid-drop-indicator";
import { useGridCellSlots } from "@/pinned-grid/use-grid-cell-slots";
import { usePendingPinFocus } from "@/pinned-grid/use-pending-pin-focus";
import { DormantCellLayer } from "@/pinned-grid/dormant-cell-summary";
import { resolveDormantCells } from "@/pinned-grid/dormant-cell-state";
import {
  selectUnmountedCells,
  useReleaseUnmountedCellSuspensions,
} from "@/pinned-grid/use-release-unmounted-cell-suspensions";
import { GridDividers } from "@/pinned-grid/grid-dividers";
import { MaximizeHiddenLayer } from "@/pinned-grid/maximize-hidden-layer";
import {
  createReducedFidelityClock,
  type ReducedFidelityClock,
} from "@/pinned-grid/reduced-fidelity-clock";
import { StreamFidelityProvider } from "@/pinned-grid/stream-fidelity-context";
import { useGridCellPresence } from "@/pinned-grid/use-grid-cell-presence";
import { useCellTimelineSuspension } from "@/pinned-grid/use-cell-timeline-suspension";
import { useSettledCellSuspension } from "@/pinned-grid/use-settled-cell-suspension";
import { useParkedCell } from "@/pinned-grid/use-parked-cell";
import { CellSuspensionProvider } from "@/pinned-grid/cell-suspension-context";
import { useFocusAfterCellRemoval } from "@/pinned-grid/use-focus-after-cell-removal";
import { useGridFocus } from "@/pinned-grid/use-grid-focus";
import { useGridLayoutPreview } from "@/pinned-grid/use-grid-layout-preview";
import { useGridFixedSurfaces } from "@/pinned-grid/use-grid-fixed-surfaces";
import { useGridScrollLayer } from "@/pinned-grid/use-grid-scroll-layer";
import {
  GRID_GAP,
  MAX_VISIBLE_ROWS,
  MIN_USABLE_CELL_HEIGHT,
  computeGridGeometry,
  type GridGeometry,
  type GridCellRect,
} from "@/pinned-grid/geometry";
import { resolveCellChromeCorners, resolveGridCellPresence } from "@/pinned-grid/grid-layout";
import {
  GridScrollSignalProvider,
  useCreateGridScrollSignal,
} from "@/pinned-grid/grid-scroll-signal";
import { resolveDeckPresentation } from "@/pinned-grid/presentation";
import { usePinnedGridPreferences } from "@/pinned-grid/use-pinned-grid-preferences";
import { usePinnedWorkspaceSelections } from "@/pinned-grid/use-pinned-workspace-selections";

const NO_SELECTIONS: ActiveWorkspaceSelection[] = [];

// The grid scrolls natively on web: the deck itself is the scroll container and the cells are
// absolutely positioned inside it, so wheel and trackpad scrolling chain out of a cell's own list.
const GRID_SCROLL_STYLE = {
  position: "relative",
  overflowX: "hidden",
  overflowY: "auto",
} as unknown as ViewStyle;
// Cells parked behind a maximized cell keep their layout, so they still extend the scroll range.
// The maximized deck does not scroll, and a classic scrollbar must not appear and narrow it.
const GRID_MAXIMIZED_SCROLL_STYLE = { overflowY: "hidden" } as unknown as ViewStyle;

function selectionKey(selection: ActiveWorkspaceSelection | null): string | null {
  return selection ? getWorkspaceSelectionKey(selection) : null;
}

export function WorkspaceDeck() {
  const routeSelection = useActiveWorkspaceSelection();
  const isCompact = useIsCompactFormFactor();
  const focusModeEnabled = usePanelStore((state) => state.desktop.focusModeEnabled);
  const { preferences, updatePreferences } = usePinnedGridPreferences();
  const pinnedSelections = usePinnedWorkspaceSelections();
  const gridScrollSignal = useCreateGridScrollSignal();

  const supportsGrid = isWeb && !isCompact;
  const measuresViewport = supportsGrid && preferences.mode !== "normal";
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const viewportReady = viewport.width > 0 && viewport.height > 0;

  const gridSupported = supportsGrid && viewportReady;
  // Unpinning the focused cell moves focus to a neighbor cell instead of leaving the grid; until
  // the route reaches that cell the deck already treats the neighbor as the active workspace.
  const activeSelection = useFocusAfterCellRemoval({
    mode: preferences.mode,
    supportsGrid: gridSupported,
    routeSelection,
    pinnedSelections,
  });
  const activeKey = selectionKey(activeSelection);
  const presentation = useMemo(
    () =>
      resolveDeckPresentation({
        mode: preferences.mode,
        supportsGrid: gridSupported,
        focusModeEnabled,
        activeSelection,
        pinnedSelections,
      }),
    [activeSelection, focusModeEnabled, gridSupported, pinnedSelections, preferences.mode],
  );
  // Focus mode shows one cell, but the other pinned cells stay retained for as long as the grid
  // would show them, so leaving focus mode brings the grid back without remounting any workspace.
  const gridWithoutFocusMode = useMemo(
    () =>
      resolveDeckPresentation({
        mode: preferences.mode,
        supportsGrid: gridSupported,
        focusModeEnabled: false,
        activeSelection,
        pinnedSelections,
      }),
    [activeSelection, gridSupported, pinnedSelections, preferences.mode],
  );
  const grid = presentation.kind === "grid" ? presentation : null;
  const pinnedForRetention =
    gridWithoutFocusMode.kind === "grid" ? gridWithoutFocusMode.cells : NO_SELECTIONS;

  const pinnedKeys = useMemo(
    () => pinnedSelections.map(getWorkspaceSelectionKey),
    [pinnedSelections],
  );
  const {
    cellKeys,
    focusedKey,
    maximizedKey,
    gridFocusedKeyRef,
    focusCell: focusCellInGrid,
    toggleMaximize,
  } = useGridFocus({ activeKey, pinnedKeys, grid });

  const { handlePicked, focusCell } = usePendingPinFocus({
    activeKey,
    pinnedKeys,
    pinnedSelections,
    focusCellInGrid,
  });

  const deckRef = useRef<View | null>(null);

  const modeKey = preferences.mode === "3" ? "3" : "2";
  const layoutPreview = useGridLayoutPreview({ preferences, modeKey, updatePreferences });
  const { columnRatios, rowScales } = layoutPreview;

  const geometry = useMemo(
    () =>
      grid
        ? computeGridGeometry({
            width: viewport.width,
            height: viewport.height,
            count: grid.cells.length + 1,
            columns: grid.columns,
            columnRatios,
            rowScales,
            gap: GRID_GAP,
            minUsableCellHeight: MIN_USABLE_CELL_HEIGHT,
            maxVisibleRows: MAX_VISIBLE_ROWS,
          })
        : null,
    [columnRatios, grid, rowScales, viewport.height, viewport.width],
  );
  const { cellRects, slotIndexByKey, dropSlotIndex, draggedKey, beginHeaderDrag } =
    useGridCellSlots({
      deckRef,
      signal: gridScrollSignal,
      grid,
      geometry,
      cellKeys,
      maximizedKey,
      viewport,
      onDragStart: focusCell,
    });
  const cellIndexByKey = useMemo(
    () => new Map(cellKeys.map((key, index) => [key, index])),
    [cellKeys],
  );
  const contentHeight = maximizedKey !== null ? viewport.height : (geometry?.contentHeight ?? 0);

  const reducedClock = useMemo(() => createReducedFidelityClock(), []);
  const { presences: cellPresences, gridCellStates } = useGridCellPresence({
    signal: gridScrollSignal,
    cells: grid ? grid.cells : null,
    geometry,
    viewportHeight: viewport.height,
    cellIndexByKey,
    focusedKey,
    maximizedKey,
  });

  const { renderedSelections, renderedEntries, unmountWorkspaceSelection } =
    useWorkspaceDeckRetention({
      activeSelection,
      pinnedForRetention,
      gridCellStates,
    });

  // react-native-web subscribes to layout once, at mount, so the handler is always attached on
  // web. Normal mode only records the size; it re-renders the deck once the grid can show.
  const latestSizeRef = useRef({ width: 0, height: 0 });
  const measuresViewportRef = useRef(measuresViewport);
  measuresViewportRef.current = measuresViewport;
  const handleDeckLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    // A hidden deck reports zero size; keep the last real geometry until it shows again.
    if (!(width > 0) || !(height > 0)) {
      return;
    }
    latestSizeRef.current = { width, height };
    if (!measuresViewportRef.current) {
      return;
    }
    setViewport((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  }, []);
  useLayoutEffect(() => {
    if (measuresViewport) {
      setViewport((current) => {
        const latest = latestSizeRef.current;
        return current.width === latest.width && current.height === latest.height
          ? current
          : latest;
      });
    }
  }, [measuresViewport]);

  const isGrid = grid !== null;
  useGridScrollLayer({
    deckRef,
    isGrid,
    maximizedKey,
    activeKey,
    gridFocusedKeyRef,
    cellRects,
    viewportHeight: viewport.height,
    signal: gridScrollSignal,
  });
  useGridFixedSurfaces({ deckRef, isGrid, signal: gridScrollSignal });

  const hasMaximizedCell = maximizedKey !== null;
  const deckStyle = useMemo(
    () =>
      isGrid
        ? [styles.deck, GRID_SCROLL_STYLE, hasMaximizedCell && GRID_MAXIMIZED_SCROLL_STYLE]
        : styles.deck,
    [hasMaximizedCell, isGrid],
  );
  const mountedKeys = useMemo(
    () => new Set(renderedSelections.map(getWorkspaceSelectionKey)),
    [renderedSelections],
  );
  const unmountedCells = useMemo(
    () => selectUnmountedCells(grid ? grid.cells : null, mountedKeys),
    [grid, mountedKeys],
  );
  useReleaseUnmountedCellSuspensions({ unmountedCells, mountedKeys });
  const dormantCells = useMemo(
    () => resolveDormantCells({ cells: grid ? grid.cells : null, mountedKeys, cellRects }),
    [cellRects, grid, mountedKeys],
  );
  const spacerStyle = useMemo(() => [styles.spacer, { height: contentHeight }], [contentHeight]);
  const dimCells = (grid?.cells.length ?? 0) > 1;

  return (
    <RenderProfile id="WorkspaceDeck">
      <GridScrollSignalProvider signal={gridScrollSignal}>
        <View
          ref={deckRef}
          style={deckStyle}
          onLayout={isWeb ? handleDeckLayout : undefined}
          testID="workspace-deck"
        >
          {isGrid ? <View pointerEvents="none" style={spacerStyle} /> : null}
          {renderedEntries.map(({ selection, active }) => {
            const key = getWorkspaceSelectionKey(selection);
            const cellIndex = cellIndexByKey.get(key);
            const isCell = grid !== null && cellIndex !== undefined;
            const presence: WorkspacePresence = grid
              ? ((isCell ? cellPresences[cellIndex] : undefined) ??
                resolveGridCellPresence({ key, isCell, focusedKey, maximizedKey }))
              : singlePresence(active);
            return (
              <WorkspaceDeckEntry
                key={key}
                selection={selection}
                presence={presence}
                isCell={isCell}
                rect={isCell ? (cellRects.get(key) ?? null) : null}
                isMaximized={maximizedKey === key}
                underMaximized={isCell && maximizedKey !== null && maximizedKey !== key}
                dimmed={dimCells}
                chromeCorners={
                  grid && cellIndex !== undefined
                    ? resolveCellChromeCorners({
                        index: slotIndexByKey.get(key) ?? cellIndex,
                        columns: grid.columns,
                        isMaximized: maximizedKey === key,
                      })
                    : "both"
                }
                clock={reducedClock}
                onUnmountInactive={unmountWorkspaceSelection}
                onFocusCell={focusCell}
                onToggleMaximize={toggleMaximize}
                onHeaderDragStart={beginHeaderDrag}
                isDragSource={key === draggedKey}
              />
            );
          })}
          {grid && geometry ? (
            <MaximizeHiddenLayer hidden={hasMaximizedCell}>
              <DormantCellLayer placements={dormantCells} onFocusCell={focusCell} />
              <GridDividers
                geometry={geometry}
                columnRatios={columnRatios}
                previewColumnRatios={layoutPreview.previewColumnRatios}
                commitColumnRatios={layoutPreview.commitColumnRatios}
                resetColumnRatios={layoutPreview.resetColumnRatios}
                previewRowScales={layoutPreview.previewRowScales}
                commitRowScales={layoutPreview.commitRowScales}
                resetRowScales={layoutPreview.resetRowScales}
              />
              <GridDeckTail
                grid={grid}
                geometry={geometry}
                hidden={hasMaximizedCell}
                draggedKey={draggedKey}
                dropSlotIndex={dropSlotIndex}
                onPicked={handlePicked}
              />
            </MaximizeHiddenLayer>
          ) : null}
        </View>
      </GridScrollSignalProvider>
    </RenderProfile>
  );
}

interface GridDeckTailProps {
  grid: { cells: ActiveWorkspaceSelection[]; columns: number };
  geometry: GridGeometry;
  hidden: boolean;
  draggedKey: string | null;
  dropSlotIndex: number | null;
  onPicked: (workspaceKey: string) => void;
}

/** The "+" tile after the last cell and the drop outline of a header drag. */
function GridDeckTail({
  grid,
  geometry,
  hidden,
  draggedKey,
  dropSlotIndex,
  onPicked,
}: GridDeckTailProps) {
  const showsDropSlot = draggedKey !== null && dropSlotIndex !== null;
  return (
    <>
      <WindowChromeRegion
        corners={resolveCellChromeCorners({
          index: grid.cells.length,
          columns: grid.columns,
          isMaximized: false,
        })}
      >
        <AddPinCell
          rect={geometry.cellRect(grid.cells.length)}
          hidden={hidden}
          onPicked={onPicked}
        />
      </WindowChromeRegion>
      {showsDropSlot ? <GridDropIndicator rect={geometry.cellRect(dropSlotIndex)} /> : null}
    </>
  );
}

interface WorkspaceDeckEntryProps {
  selection: ActiveWorkspaceSelection;
  presence: WorkspacePresence;
  isCell: boolean;
  rect: GridCellRect | null;
  isMaximized: boolean;
  underMaximized: boolean;
  dimmed: boolean;
  chromeCorners: "both" | "top-left" | "top-right" | "none";
  clock: ReducedFidelityClock;
  onUnmountInactive: (selection: ActiveWorkspaceSelection) => void;
  onFocusCell: (key: string) => boolean;
  onToggleMaximize: (key: string) => void;
  onHeaderDragStart: (key: string, event: PointerEvent, node: HTMLElement) => void;
  isDragSource: boolean;
}

const WorkspaceDeckEntry = memo(function WorkspaceDeckEntry({
  selection,
  presence: livePresence,
  isCell,
  rect,
  isMaximized,
  underMaximized,
  dimmed,
  chromeCorners,
  clock,
  onUnmountInactive,
  onFocusCell,
  onToggleMaximize,
  onHeaderDragStart,
  isDragSource,
}: WorkspaceDeckEntryProps) {
  // A cell that a maximize hides keeps its content on screen while it fades out.
  const shownPresence = useFadeOutPresence(livePresence, isCell && underMaximized);
  const isShown = isPresented(shownPresence);
  const parked = useParkedCell({ underMaximized: isCell && underMaximized, isPresented: isShown });
  // The workspace of a parked cell keeps a reduced presence for the whole maximize and the frame
  // hides it. A presence change renders the whole workspace again, which made the fade settle and
  // the restore commit render every cell that was on screen. A parked cell still owns no input,
  // and it releases its timeline and terminal streams through the suspension below.
  const presence: WorkspacePresence = parked ? "reduced" : shownPresence;
  const hasHydratedWorkspaces = useHasHydratedWorkspaces(selection.serverId);
  const workspaceExists = useWorkspaceExists(selection.serverId, selection.workspaceId);
  // A string selector, so the entry renders again only when the title changes.
  const cellLabel = useSessionStore((state) => {
    const workspace = state.sessions[selection.serverId]?.workspaces.get(selection.workspaceId);
    return workspace ? resolveWorkspaceHeader({ workspace }).title : undefined;
  });
  const isPresentedEntry = isPresented(presence);
  const shouldKeepMounted = shouldKeepWorkspaceDeckEntryMounted({
    isActive: isPresentedEntry,
    hasHydratedWorkspaces,
    workspaceExists,
  });

  useEffect(() => {
    if (!shouldKeepMounted) {
      onUnmountInactive(selection);
    }
  }, [onUnmountInactive, selection, shouldKeepMounted]);
  // A hidden grid cell holds no timeline subscription; other entries keep the established rule
  // that an opened chat stays subscribed. The held presence suspends a cell after its fade, and a
  // restored cell resumes after the motion, so no catch-up runs while a cell animates.
  const settledSuspended = useSettledCellSuspension({
    hidden: shownPresence === "hidden",
    underMaximized,
  });
  const cellSuspended = isCell && settledSuspended;
  useCellTimelineSuspension({
    serverId: selection.serverId,
    workspaceId: selection.workspaceId,
    suspended: cellSuspended,
  });

  if (!shouldKeepMounted) {
    return null;
  }

  // The entry reads its own host, not the host of the route that renders the deck.
  return (
    <HostRouteProvider serverId={selection.serverId}>
      <GridCellFrame
        cellKey={getWorkspaceSelectionKey(selection)}
        label={cellLabel}
        isCell={isCell}
        isVisible={isShown}
        rect={rect}
        isFocused={presence === "focused"}
        isMaximized={isMaximized}
        underMaximized={underMaximized}
        parked={parked}
        dimmed={dimmed}
        chromeCorners={chromeCorners}
        onFocusCell={onFocusCell}
        onToggleMaximize={onToggleMaximize}
        onHeaderDragStart={onHeaderDragStart}
        isDragSource={isDragSource}
      >
        <StreamFidelityProvider
          fidelity={presence === "reduced" ? "reduced" : "full"}
          clock={clock}
        >
          <CellSuspensionProvider value={cellSuspended}>
            <RetainedPanel
              active={isPresentedEntry}
              keepLayout={parked}
              testID={`workspace-deck-entry-${selection.serverId}:${selection.workspaceId}`}
            >
              <WorkspaceScreen
                serverId={selection.serverId}
                workspaceId={selection.workspaceId}
                presence={presence}
              />
            </RetainedPanel>
          </CellSuspensionProvider>
        </StreamFidelityProvider>
      </GridCellFrame>
    </HostRouteProvider>
  );
});

const styles = StyleSheet.create({
  deck: {
    flex: 1,
  },
  spacer: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 1,
  },
});
