export const GRID_GAP = 8;

// A grid cell is usable when it fits the cell header and tab bar (about 70 px),
// the minimal composer (about 45 px) and about 8 transcript lines. That adds up
// to 300 px, so a common 1280x720 laptop shows 2 rows. The value picks how many
// rows are visible; it is not a fixed cell size.
export const MIN_USABLE_CELL_HEIGHT = 300;

// One screen shows at most 2 rows: 4 cells in 2 columns, 6 in 3 columns. A tall
// screen makes the cells taller instead of adding rows, because a cell is a full
// workspace and a third row of 300 px cells is too small to read. More rows scroll.
export const MAX_VISIBLE_ROWS = 2;

export interface GridGeometryInput {
  /** Measured grid viewport width in px. */
  width: number;
  /** Measured grid viewport height in px. */
  height: number;
  count: number;
  columns: 2 | 3;
  /** Share of the available width per column. Falls back to equal shares when the length differs. */
  columnRatios: number[];
  /**
   * Relative height weight per row. Falls back to equal rows when the length differs. The
   * weights are normalized, so they only share out the rows' total height and never change it.
   */
  rowScales: number[];
  gap: number;
  /** Threshold that picks the number of visible rows. It is not a cell size. */
  minUsableCellHeight: number;
  /** Upper bound on the number of rows one screen shows. */
  maxVisibleRows: number;
}

export interface GridCellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridGeometry {
  rows: number;
  visibleRows: number;
  baseRowHeight: number;
  columnX: number[];
  columnWidth: number[];
  rowY: number[];
  rowHeight: number[];
  contentHeight: number;
  cellRect(index: number): GridCellRect;
}

const EMPTY_RECT: GridCellRect = { x: 0, y: 0, width: 0, height: 0 };

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function accumulate(sizes: number[], gap: number): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const size of sizes) {
    offsets.push(offset);
    offset += size + gap;
  }
  return offsets;
}

function emptyGeometry(): GridGeometry {
  return {
    rows: 0,
    visibleRows: 0,
    baseRowHeight: 0,
    columnX: [],
    columnWidth: [],
    rowY: [],
    rowHeight: [],
    contentHeight: 0,
    cellRect: () => EMPTY_RECT,
  };
}

/**
 * Shares `rows * baseRowHeight` between the rows by weight. The total does not depend on the
 * weights, so when every row fits the screen the rows fill it exactly and a drag can never push
 * rows off screen. Weights stored for a different row count are ignored, as column ratios are:
 * they describe rows that no longer exist after a pin or an unpin.
 */
export function distributeRowHeights(
  rows: number,
  baseRowHeight: number,
  rowScales: readonly number[],
): number[] {
  const stored = rowScales.length === rows ? rowScales : [];
  const weights = Array.from({ length: rows }, (_, row) => {
    const weight = stored[row];
    return weight !== undefined && Number.isFinite(weight) && weight > 0 ? weight : 1;
  });
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  return weights.map((weight) => (baseRowHeight * rows * weight) / totalWeight);
}

export function computeGridGeometry(input: GridGeometryInput): GridGeometry {
  const { width, height, count, columns, gap, minUsableCellHeight, maxVisibleRows } = input;
  if (!isPositiveFinite(width) || !isPositiveFinite(height) || !(count > 0)) {
    return emptyGeometry();
  }

  const rows = Math.ceil(count / columns);
  const ratios =
    input.columnRatios.length === columns
      ? input.columnRatios
      : Array.from({ length: columns }, () => 1 / columns);
  const columnArea = Math.max(0, width - gap * (columns - 1));
  const columnWidth = ratios.map((ratio) => ratio * columnArea);

  const fitting = Math.floor((height + gap) / (minUsableCellHeight + gap));
  const visibleRows = Math.min(rows, Math.max(1, Math.min(maxVisibleRows, fitting)));
  const baseRowHeight = Math.max(0, (height - gap * (visibleRows - 1)) / visibleRows);
  const rowHeight = distributeRowHeights(rows, baseRowHeight, input.rowScales);

  const columnX = accumulate(columnWidth, gap);
  const rowY = accumulate(rowHeight, gap);
  const lastRow = rows - 1;
  const contentHeight = (rowY[lastRow] ?? 0) + (rowHeight[lastRow] ?? 0);

  return {
    rows,
    visibleRows,
    baseRowHeight,
    columnX,
    columnWidth,
    rowY,
    rowHeight,
    contentHeight,
    cellRect(index) {
      if (!Number.isInteger(index) || index < 0 || index >= count) {
        return EMPTY_RECT;
      }
      const row = Math.floor(index / columns);
      const column = index % columns;
      return {
        x: columnX[column] ?? 0,
        y: rowY[row] ?? 0,
        width: columnWidth[column] ?? 0,
        height: rowHeight[row] ?? 0,
      };
    },
  };
}
