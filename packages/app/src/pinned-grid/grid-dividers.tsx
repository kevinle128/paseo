import { memo, useCallback, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ResizeHandle } from "@/components/resize-handle";
import type { GridGeometry } from "./geometry";
import { GRID_GAP } from "./geometry";
import { ROW_DRAG_CONTAINER_SIZE, rowScalesFromDrag } from "./grid-divider-model";
import { MIN_GRID_ROW_HEIGHT } from "./grid-layout";

// Dividers have no identity beyond their position, and a position key keeps a divider mounted
// while its own drag moves the layout under it.
function dividerSlots(prefix: string, count: number): Array<{ id: string; index: number }> {
  return Array.from({ length: Math.max(0, count) }, (_, index) => ({
    id: `${prefix}-${index}`,
    index,
  }));
}

const COLUMN_GROUP_ID = "pinned-grid-columns";
const ROW_GROUP_ID = "pinned-grid-rows";

interface GridDividersProps {
  geometry: GridGeometry;
  columnRatios: number[];
  previewColumnRatios: (ratios: number[]) => void;
  commitColumnRatios: (ratios: number[]) => void;
  resetColumnRatios: () => void;
  previewRowScales: (scales: number[]) => void;
  commitRowScales: (scales: number[]) => void;
  resetRowScales: () => void;
}

/**
 * Column and row dividers between grid cells. They are siblings of the cells, never their
 * parents, so adding or moving a divider cannot remount a workspace.
 */
export const GridDividers = memo(function GridDividers({
  geometry,
  columnRatios,
  previewColumnRatios,
  commitColumnRatios,
  resetColumnRatios,
  previewRowScales,
  commitRowScales,
  resetRowScales,
}: GridDividersProps) {
  const columnArea = useMemo(
    () => geometry.columnWidth.reduce((total, width) => total + width, 0),
    [geometry.columnWidth],
  );
  const gridWidth = columnArea + GRID_GAP * Math.max(0, geometry.columnWidth.length - 1);

  const handleColumnPreview = useCallback(
    (_groupId: string, sizes: number[]) => previewColumnRatios(sizes),
    [previewColumnRatios],
  );
  const handleColumnCommit = useCallback(
    (_groupId: string, sizes: number[]) => commitColumnRatios(sizes),
    [commitColumnRatios],
  );

  const columnDividers = dividerSlots("column", geometry.columnWidth.length - 1).map(
    ({ id, index }) => (
      <View
        key={id}
        style={[
          styles.columnSlot,
          {
            left: (geometry.columnX[index] ?? 0) + (geometry.columnWidth[index] ?? 0),
            height: geometry.contentHeight,
          },
        ]}
      >
        <ResizeHandle
          testID={`pinned-grid-column-divider-${index}`}
          direction="horizontal"
          groupId={COLUMN_GROUP_ID}
          index={index}
          sizes={columnRatios}
          containerSize={columnArea}
          onPreviewResizeSplit={handleColumnPreview}
          onResizeSplit={handleColumnCommit}
          onDoubleClick={resetColumnRatios}
        />
      </View>
    ),
  );

  const rowDividers = dividerSlots("row", geometry.rowHeight.length - 1).map(({ id, index }) => (
    <GridRowDivider
      key={id}
      index={index}
      top={(geometry.rowY[index] ?? 0) + (geometry.rowHeight[index] ?? 0)}
      width={gridWidth}
      rowHeights={geometry.rowHeight}
      baseRowHeight={geometry.baseRowHeight}
      previewRowScales={previewRowScales}
      commitRowScales={commitRowScales}
      resetRowScales={resetRowScales}
    />
  ));

  return (
    <>
      {columnDividers}
      {rowDividers}
    </>
  );
});

interface GridRowDividerProps {
  index: number;
  top: number;
  width: number;
  rowHeights: number[];
  baseRowHeight: number;
  previewRowScales: (scales: number[]) => void;
  commitRowScales: (scales: number[]) => void;
  resetRowScales: () => void;
}

function GridRowDivider({
  index,
  top,
  width,
  rowHeights,
  baseRowHeight,
  previewRowScales,
  commitRowScales,
  resetRowScales,
}: GridRowDividerProps) {
  const toScales = useCallback(
    (draggedSizes: number[]) =>
      rowScalesFromDrag({
        rowHeights,
        index,
        draggedSizes,
        baseRowHeight,
        minRowHeight: MIN_GRID_ROW_HEIGHT,
      }),
    [baseRowHeight, index, rowHeights],
  );
  const handlePreview = useCallback(
    (_groupId: string, draggedSizes: number[]) => previewRowScales(toScales(draggedSizes)),
    [previewRowScales, toScales],
  );
  const handleCommit = useCallback(
    (_groupId: string, draggedSizes: number[]) => commitRowScales(toScales(draggedSizes)),
    [commitRowScales, toScales],
  );

  return (
    <View style={[styles.rowSlot, { top, width }]}>
      <ResizeHandle
        testID={`pinned-grid-row-divider-${index}`}
        direction="vertical"
        groupId={ROW_GROUP_ID}
        index={index}
        sizes={rowHeights}
        containerSize={ROW_DRAG_CONTAINER_SIZE}
        onPreviewResizeSplit={handlePreview}
        onResizeSplit={handleCommit}
        onDoubleClick={resetRowScales}
      />
    </View>
  );
}

const styles = StyleSheet.create(() => ({
  columnSlot: {
    position: "absolute",
    top: 0,
    width: GRID_GAP,
    flexDirection: "row",
    justifyContent: "center",
    zIndex: 5,
  },
  rowSlot: {
    position: "absolute",
    left: 0,
    height: GRID_GAP,
    justifyContent: "center",
    zIndex: 5,
  },
}));
