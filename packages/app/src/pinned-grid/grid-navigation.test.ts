import { describe, expect, it } from "vitest";
import { resolveGridNeighbor, type GridDirection } from "./grid-navigation";

function move(count: number, columns: number, index: number, direction: GridDirection) {
  return resolveGridNeighbor({ count, columns, index, direction });
}

describe("resolveGridNeighbor", () => {
  it("moves left and right inside a row", () => {
    expect(move(6, 3, 1, "left")).toBe(0);
    expect(move(6, 3, 1, "right")).toBe(2);
  });

  it("does not wrap at the row edges", () => {
    expect(move(6, 3, 0, "left")).toBeNull();
    expect(move(6, 3, 2, "right")).toBeNull();
    expect(move(6, 3, 3, "left")).toBeNull();
  });

  it("stops at the last cell of a partial last row", () => {
    expect(move(5, 3, 4, "right")).toBeNull();
    expect(move(5, 3, 3, "right")).toBe(4);
  });

  it("moves up and down by one row", () => {
    expect(move(6, 2, 2, "up")).toBe(0);
    expect(move(6, 2, 2, "down")).toBe(4);
    expect(move(6, 2, 5, "up")).toBe(3);
  });

  it("does nothing up from the first row and down from the last row", () => {
    expect(move(6, 3, 1, "up")).toBeNull();
    expect(move(6, 3, 4, "down")).toBeNull();
  });

  it("goes down to the last cell of a shorter next row", () => {
    expect(move(4, 3, 2, "down")).toBe(3);
    expect(move(5, 3, 2, "down")).toBe(4);
  });

  it("does nothing down from a cell in the last row of a partial grid", () => {
    expect(move(5, 3, 4, "down")).toBeNull();
    expect(move(5, 3, 3, "down")).toBeNull();
  });

  it("handles a single cell and invalid input", () => {
    expect(move(1, 2, 0, "right")).toBeNull();
    expect(move(1, 2, 0, "down")).toBeNull();
    expect(move(3, 2, 3, "left")).toBeNull();
    expect(move(3, 0, 0, "right")).toBeNull();
  });
});
