export type GridDirection = "left" | "right" | "up" | "down";

/**
 * The cell index that arrow-key navigation reaches from `index`, or null when there is none.
 * Cells fill rows left to right and the last row may be partial. Movement never wraps. Down from
 * a cell that has no cell below it goes to the last cell of the next row, so the key still moves
 * when the next row is shorter than the current column.
 */
export function resolveGridNeighbor(input: {
  count: number;
  columns: number;
  index: number;
  direction: GridDirection;
}): number | null {
  const { count, columns, index, direction } = input;
  if (columns < 1 || index < 0 || index >= count) {
    return null;
  }
  switch (direction) {
    case "left":
      return index % columns === 0 ? null : index - 1;
    case "right":
      return index % columns === columns - 1 || index + 1 >= count ? null : index + 1;
    case "up":
      return index - columns < 0 ? null : index - columns;
    case "down": {
      const below = index + columns;
      if (below < count) {
        return below;
      }
      const hasNextRow = Math.floor(index / columns) < Math.floor((count - 1) / columns);
      return hasNextRow ? count - 1 : null;
    }
  }
}
