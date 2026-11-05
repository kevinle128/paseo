export const GRID_GAP = 8;

// A grid cell is usable when it fits the cell header and tab bar (about 70 px),
// the minimal composer (about 45 px) and about 8 transcript lines. That adds up
// to 300 px, so a common 1280x720 laptop shows 2 rows. The value picks how many
// rows are visible; it is not a fixed cell size.
export const MIN_USABLE_CELL_HEIGHT = 300;

export interface GridGeometryInput {
  /** Measured grid viewport width in px. */
  width: number;
  /** Measured grid viewport height in px. */
  height: number;
  count: number;
  columns: 2 | 3;
  /** Share of the available width per column. Falls back to equal shares when the length differs. */
  columnRatios: number[];
  /** Multiplier of the base row height per row. Missing entries mean 1. */
  rowScales: number[];
  gap: number;
  /** Threshold that picks the number of visible rows. It is not a cell size. */
  minUsableCellHeight: number;
  minRowHeight: number;
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

export function computeGridGeometry(input: GridGeometryInput): GridGeometry {
  const { width, height, count, columns, gap, minUsableCellHeight, minRowHeight } = input;
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
  const visibleRows = Math.min(rows, Math.max(1, fitting));
  const baseRowHeight = Math.max(0, (height - gap * (visibleRows - 1)) / visibleRows);
  const rowHeight = Array.from({ length: rows }, (_, row) =>
    Math.max(minRowHeight, baseRowHeight * (input.rowScales[row] ?? 1)),
  );

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
