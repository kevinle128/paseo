interface ResizeRowInput {
  rowScales: number[];
  index: number;
  /** Row height in px when the drag started. */
  startHeight: number;
  deltaPx: number;
  baseRowHeight: number;
  minRowHeight: number;
}

/**
 * Returns the row scales after dragging one row divider. Only the dragged row
 * changes; its height clamps at `minRowHeight`. Missing earlier scales read as 1.
 */
export function resizeRow({
  rowScales,
  index,
  startHeight,
  deltaPx,
  baseRowHeight,
  minRowHeight,
}: ResizeRowInput): number[] {
  const next = rowScales.slice();
  if (!Number.isInteger(index) || index < 0 || !(baseRowHeight > 0)) {
    return next;
  }
  while (next.length <= index) {
    next.push(1);
  }
  next[index] = Math.max(minRowHeight, startHeight + deltaPx) / baseRowHeight;
  return next;
}
