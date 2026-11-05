import type { WorkspacePresence } from "@/screens/workspace/workspace-presence";
import type { GridCellRect } from "./geometry";

/** Share of the viewport height that counts as near enough to keep a cell live. */
export const CELL_OVERSCAN_RATIO = 0.25;
/** A cell stays `reduced` this long after it leaves the screen, so scroll thrash does not unmount streams. */
export const CELL_HIDDEN_DELAY_MS = 2_000;

interface CellViewport {
  scrollTop: number;
  viewportHeight: number;
  overscanPx: number;
}

/** Whether a cell's vertical extent meets the viewport grown by the overscan on both sides. */
export function isCellNearViewport(rect: GridCellRect, view: CellViewport): boolean {
  const top = view.scrollTop - view.overscanPx;
  const bottom = view.scrollTop + view.viewportHeight + view.overscanPx;
  return rect.y + rect.height > top && rect.y < bottom;
}

/**
 * Distance in px between a cell and the viewport, zero while they meet. Orders hidden cells by how
 * soon the user can scroll to them.
 */
export function distanceFromViewport(rect: GridCellRect, view: CellViewport): number {
  const viewTop = view.scrollTop;
  const viewBottom = view.scrollTop + view.viewportHeight;
  if (rect.y + rect.height <= viewTop) {
    return viewTop - (rect.y + rect.height);
  }
  if (rect.y >= viewBottom) {
    return rect.y - viewBottom;
  }
  return 0;
}

/**
 * Updates the time each cell was last near the screen. A cell that is near now gets `now`; one
 * that never was keeps `-Infinity`, so a cell that starts off screen is `hidden` at once.
 */
export function updateLastOnScreenAt(input: {
  rects: readonly GridCellRect[];
  view: CellViewport;
  now: number;
  previous: readonly number[];
}): number[] {
  const { rects, view, now, previous } = input;
  const next = rects.map((rect, index) =>
    isCellNearViewport(rect, view) ? now : (previous[index] ?? Number.NEGATIVE_INFINITY),
  );
  const unchanged = next.length === previous.length && next.every((v, i) => v === previous[i]);
  return unchanged ? (previous as number[]) : next;
}

/**
 * Presence of every grid cell. Pure on purpose: the clock, scroll offset and rects arrive as
 * values. Exactly one cell is `focused` (the maximized one while a cell is maximized). The result
 * is `previous` itself when nothing changed, so a `memo` keyed on it holds.
 */
export function resolveCellPresences(input: {
  rects: readonly GridCellRect[];
  scrollTop: number;
  viewportHeight: number;
  overscanPx: number;
  focusedIndex: number;
  maximizedIndex: number | null;
  now: number;
  lastOnScreenAt: readonly number[];
  hiddenDelayMs: number;
  previous?: readonly WorkspacePresence[];
}): WorkspacePresence[] {
  const { rects, focusedIndex, maximizedIndex, now, lastOnScreenAt, hiddenDelayMs, previous } =
    input;
  const view = {
    scrollTop: input.scrollTop,
    viewportHeight: input.viewportHeight,
    overscanPx: input.overscanPx,
  };
  const next = rects.map((rect, index): WorkspacePresence => {
    if (maximizedIndex !== null) {
      return index === maximizedIndex ? "focused" : "hidden";
    }
    if (index === focusedIndex) {
      return "focused";
    }
    if (isCellNearViewport(rect, view)) {
      return "reduced";
    }
    const offScreenFor = now - (lastOnScreenAt[index] ?? Number.NEGATIVE_INFINITY);
    return offScreenFor >= hiddenDelayMs ? "hidden" : "reduced";
  });
  if (
    previous &&
    previous.length === next.length &&
    next.every((value, index) => value === previous[index])
  ) {
    return previous as WorkspacePresence[];
  }
  return next;
}

/**
 * The next time a `reduced` off-screen cell turns `hidden`, or null when none is waiting. The deck
 * re-evaluates then, because no scroll event arrives while the user stands still.
 */
export function nextHiddenDeadline(input: {
  presences: readonly WorkspacePresence[];
  rects: readonly GridCellRect[];
  scrollTop: number;
  viewportHeight: number;
  overscanPx: number;
  lastOnScreenAt: readonly number[];
  hiddenDelayMs: number;
}): number | null {
  const view = {
    scrollTop: input.scrollTop,
    viewportHeight: input.viewportHeight,
    overscanPx: input.overscanPx,
  };
  let deadline: number | null = null;
  input.presences.forEach((presence, index) => {
    const rect = input.rects[index];
    const last = input.lastOnScreenAt[index];
    if (presence !== "reduced" || !rect || last === undefined || !Number.isFinite(last)) {
      return;
    }
    if (isCellNearViewport(rect, view)) {
      return;
    }
    const at = last + input.hiddenDelayMs;
    deadline = deadline === null ? at : Math.min(deadline, at);
  });
  return deadline;
}

export interface CellPresenceSnapshot {
  presences: WorkspacePresence[];
  /** Distance in px of each cell from the viewport at the time of the last change. */
  distances: number[];
  /** When the next reduced off-screen cell turns hidden, or null. */
  deadline: number | null;
}

export interface CellPresenceInput {
  rects: readonly GridCellRect[];
  scrollTop: number;
  viewportHeight: number;
  focusedIndex: number;
  maximizedIndex: number | null;
  now: number;
}

const EMPTY_SNAPSHOT: CellPresenceSnapshot = { presences: [], distances: [], deadline: null };

/**
 * Remembers when each cell was last near the screen and answers with the presence of every cell.
 * `preview` reads and never writes, so render can call it. `evaluate` records the observation
 * and belongs in effects and event handlers. The snapshot keeps its identity while the presences
 * do not change.
 */
export class CellPresenceTracker {
  private lastOnScreenAt: number[] = [];
  private snapshot: CellPresenceSnapshot = EMPTY_SNAPSHOT;

  constructor(
    private readonly options: { hiddenDelayMs: number; overscanRatio: number } = {
      hiddenDelayMs: CELL_HIDDEN_DELAY_MS,
      overscanRatio: CELL_OVERSCAN_RATIO,
    },
  ) {}

  evaluate(input: CellPresenceInput): CellPresenceSnapshot {
    const { lastOnScreenAt, snapshot } = this.compute(input);
    this.lastOnScreenAt = lastOnScreenAt;
    this.snapshot = snapshot;
    return snapshot;
  }

  /** The snapshot `evaluate` would return, without recording the observation. */
  preview(input: CellPresenceInput): CellPresenceSnapshot {
    return this.compute(input).snapshot;
  }

  private compute(input: CellPresenceInput): {
    lastOnScreenAt: number[];
    snapshot: CellPresenceSnapshot;
  } {
    const overscanPx = Math.round(input.viewportHeight * this.options.overscanRatio);
    const view = { scrollTop: input.scrollTop, viewportHeight: input.viewportHeight, overscanPx };
    const lastOnScreenAt = updateLastOnScreenAt({
      rects: input.rects,
      view,
      now: input.now,
      previous: this.lastOnScreenAt.length === input.rects.length ? this.lastOnScreenAt : [],
    });
    const presences = resolveCellPresences({
      rects: input.rects,
      scrollTop: input.scrollTop,
      viewportHeight: input.viewportHeight,
      overscanPx,
      focusedIndex: input.focusedIndex,
      maximizedIndex: input.maximizedIndex,
      now: input.now,
      lastOnScreenAt,
      hiddenDelayMs: this.options.hiddenDelayMs,
      previous: this.snapshot.presences,
    });
    const deadline =
      input.maximizedIndex !== null
        ? null
        : nextHiddenDeadline({
            presences,
            rects: input.rects,
            scrollTop: input.scrollTop,
            viewportHeight: input.viewportHeight,
            overscanPx,
            lastOnScreenAt,
            hiddenDelayMs: this.options.hiddenDelayMs,
          });
    const distances = input.rects.map((rect) => distanceFromViewport(rect, view));
    const unchanged =
      presences === this.snapshot.presences &&
      deadline === this.snapshot.deadline &&
      distances.length === this.snapshot.distances.length &&
      distances.every((value, index) => value === this.snapshot.distances[index]);
    return {
      lastOnScreenAt,
      snapshot: unchanged ? this.snapshot : { presences, distances, deadline },
    };
  }
}
