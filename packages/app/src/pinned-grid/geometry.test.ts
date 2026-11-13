import { describe, expect, it } from "vitest";
import { computeResizeHandleSizes } from "@/components/resize-handle-sizes";
import {
  computeGridGeometry,
  distributeRowHeights,
  MAX_VISIBLE_ROWS,
  MIN_USABLE_CELL_HEIGHT,
  type GridGeometryInput,
} from "./geometry";

function input(overrides: Partial<GridGeometryInput>): GridGeometryInput {
  const columns = overrides.columns ?? 2;
  return {
    width: 1000,
    height: 600,
    count: 4,
    columns,
    columnRatios: Array.from({ length: columns }, () => 1 / columns),
    rowScales: [],
    gap: 8,
    minUsableCellHeight: MIN_USABLE_CELL_HEIGHT,
    maxVisibleRows: MAX_VISIBLE_ROWS,
    ...overrides,
  };
}

describe("computeGridGeometry", () => {
  it("uses 300 as the usable cell height threshold and shows at most 2 rows", () => {
    expect(MIN_USABLE_CELL_HEIGHT).toBe(300);
    expect(MAX_VISIBLE_ROWS).toBe(2);
  });

  const cases = [
    {
      name: "1000x624 two columns",
      width: 1000,
      height: 624,
      columns: 2,
      count: 7,
      rows: 4,
      visibleRows: 2,
      rowHeight: 308,
    },
    {
      name: "1160x800 two columns",
      width: 1160,
      height: 800,
      columns: 2,
      count: 6,
      rows: 3,
      visibleRows: 2,
      rowHeight: 396,
    },
    {
      name: "1320x904 two columns",
      width: 1320,
      height: 904,
      columns: 2,
      count: 6,
      rows: 3,
      visibleRows: 2,
      rowHeight: 448,
    },
    {
      name: "2280x1344 two columns",
      width: 2280,
      height: 1344,
      columns: 2,
      count: 7,
      rows: 4,
      visibleRows: 2,
      rowHeight: 668,
    },
    {
      name: "2280x1344 three columns",
      width: 2280,
      height: 1344,
      columns: 3,
      count: 15,
      rows: 5,
      visibleRows: 2,
      rowHeight: 668,
    },
  ] as const;

  it.each(cases)("$name", ({ width, height, columns, count, rows, visibleRows, rowHeight }) => {
    const geometry = computeGridGeometry(input({ width, height, columns, count }));
    expect(geometry.rows).toBe(rows);
    expect(geometry.visibleRows).toBe(visibleRows);
    expect(geometry.baseRowHeight).toBe(rowHeight);
    expect(geometry.rowHeight).toEqual(Array.from({ length: rows }, () => rowHeight));
  });

  it("sizes a cell from the column ratio and base row height", () => {
    const geometry = computeGridGeometry(input({ width: 1320, height: 904, count: 6 }));
    expect(geometry.cellRect(0)).toEqual({ x: 0, y: 0, width: 656, height: 448 });
    expect(geometry.cellRect(1)).toEqual({ x: 664, y: 0, width: 656, height: 448 });
    expect(geometry.cellRect(2)).toEqual({ x: 0, y: 456, width: 656, height: 448 });
  });

  it("applies unequal column ratios to every row", () => {
    const geometry = computeGridGeometry(
      input({ width: 1008, height: 800, count: 4, columnRatios: [0.25, 0.75] }),
    );
    expect(geometry.columnWidth).toEqual([250, 750]);
    expect(geometry.columnX).toEqual([0, 258]);
    expect(geometry.cellRect(3).width).toBe(750);
  });

  it("fills the height with one row for a single cell", () => {
    const geometry = computeGridGeometry(input({ width: 800, height: 500, count: 1 }));
    expect(geometry.rows).toBe(1);
    expect(geometry.visibleRows).toBe(1);
    expect(geometry.cellRect(0).height).toBe(500);
    expect(geometry.contentHeight).toBe(500);
  });

  it("shows one row when the area is shorter than the threshold", () => {
    const geometry = computeGridGeometry(input({ height: 200, count: 6 }));
    expect(geometry.visibleRows).toBe(1);
    expect(geometry.baseRowHeight).toBe(200);
    expect(geometry.contentHeight).toBe(3 * 200 + 2 * 8);
  });

  it.each([
    { columns: 2 as const, count: 4 },
    { columns: 3 as const, count: 6 },
  ])("fills a 2560x1410 screen with $count cells in $columns columns", ({ columns, count }) => {
    const geometry = computeGridGeometry(input({ width: 2200, height: 1410, columns, count }));
    expect(geometry.visibleRows).toBe(2);
    expect(geometry.rowHeight).toEqual([701, 701]);
    expect(geometry.contentHeight).toBe(1410);
  });

  it("scrolls the rows after the first two", () => {
    const geometry = computeGridGeometry(input({ width: 2200, height: 1410, count: 8 }));
    expect(geometry.rows).toBe(4);
    expect(geometry.rowY[2]).toBe(1418);
    expect(geometry.contentHeight).toBe(4 * 701 + 3 * 8);
  });

  it("shares the rows' height by weight without changing the total", () => {
    const geometry = computeGridGeometry(
      input({ width: 1000, height: 624, count: 4, rowScales: [1.5, 0.5] }),
    );
    expect(geometry.rowHeight).toEqual([462, 154]);
    expect(geometry.contentHeight).toBe(624);
  });

  it("ignores stored weights from a different row count", () => {
    const geometry = computeGridGeometry(
      input({ width: 2200, height: 1410, count: 8, rowScales: [2.31, 1.23] }),
    );
    expect(geometry.rowHeight).toEqual([701, 701, 701, 701]);
  });

  it("keeps a full screen with uneven weights", () => {
    const geometry = computeGridGeometry(
      input({ width: 2200, height: 1410, count: 4, rowScales: [2.31, 1.23] }),
    );
    expect(geometry.rowHeight[0]! + geometry.rowHeight[1]!).toBeCloseTo(1402, 6);
    expect(geometry.contentHeight).toBeCloseTo(1410, 6);
  });

  it.each([
    { name: "zero width", width: 0 },
    { name: "zero height", height: 0 },
    { name: "zero count", count: 0 },
  ])("returns an empty geometry for $name", (overrides) => {
    const geometry = computeGridGeometry(input(overrides));
    expect(geometry.rows).toBe(0);
    expect(geometry.visibleRows).toBe(0);
    expect(geometry.contentHeight).toBe(0);
    expect(geometry.rowHeight).toEqual([]);
    expect(geometry.cellRect(0)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    for (const value of [geometry.baseRowHeight, ...geometry.columnWidth, ...geometry.columnX]) {
      expect(Number.isNaN(value)).toBe(false);
    }
  });

  it("returns a zero rect for an out-of-range cell index", () => {
    const geometry = computeGridGeometry(input({ count: 3 }));
    expect(geometry.cellRect(3)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(geometry.cellRect(-1)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("reuses the split resize helper so a column pair keeps its sum", () => {
    const ratios = [0.5, 0.5];
    const resized = computeResizeHandleSizes({ sizes: ratios, index: 0, deltaRatio: 0.2 });
    expect(resized[0]! + resized[1]!).toBeCloseTo(1, 10);
    const geometry = computeGridGeometry(input({ width: 1008, count: 4, columnRatios: resized }));
    expect(geometry.columnWidth[0]! + geometry.columnWidth[1]!).toBeCloseTo(1000, 6);
    expect(geometry.columnWidth[0]).toBeCloseTo(700, 6);
  });
});

describe("distributeRowHeights", () => {
  it("treats missing and invalid weights as 1", () => {
    expect(distributeRowHeights(3, 100, [2, Number.NaN, 1])).toEqual([150, 75, 75]);
    expect(distributeRowHeights(2, 100, [0, -1])).toEqual([100, 100]);
    expect(distributeRowHeights(2, 100, [3])).toEqual([100, 100]);
  });
});
