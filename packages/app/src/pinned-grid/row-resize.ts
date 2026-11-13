interface ResizeRowPairInput {
  /** Current row heights in px. */
  rowHeights: number[];
  /** Divider index: the divider below row `index` and above row `index + 1`. */
  index: number;
  /** Requested height of row `index` in px. */
  nextHeight: number;
  baseRowHeight: number;
  minRowHeight: number;
}

/**
 * Returns the row weights after dragging one row divider. Height moves between the two rows next
 * to the divider and their sum stays the same, so the grid's total height does not change. Each of
 * the two rows clamps at `minRowHeight`, or at half the pair when the pair is smaller than two
 * minimums. Weights are heights divided by the base row height.
 */
export function resizeRowPair({
  rowHeights,
  index,
  nextHeight,
  baseRowHeight,
  minRowHeight,
}: ResizeRowPairInput): number[] {
  const toWeights = (heights: number[]) =>
    baseRowHeight > 0 ? heights.map((height) => height / baseRowHeight) : heights.map(() => 1);
  const upper = rowHeights[index];
  const lower = rowHeights[index + 1];
  if (!Number.isInteger(index) || upper === undefined || lower === undefined) {
    return toWeights(rowHeights);
  }
  const pair = upper + lower;
  const min = Math.min(minRowHeight, pair / 2);
  const nextUpper = Math.min(pair - min, Math.max(min, nextHeight));
  const next = rowHeights.slice();
  next[index] = nextUpper;
  next[index + 1] = pair - nextUpper;
  return toWeights(next);
}
