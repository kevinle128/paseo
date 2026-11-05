import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  type RefObject,
} from "react";
import type { View } from "react-native";
import { isWeb } from "@/constants/platform";
import { CellPresenceTracker, type CellPresenceSnapshot } from "./cell-presence";
import type { GridCellRect } from "./geometry";
import type { GridScrollSignal } from "./grid-scroll-signal";

const NO_CELLS: CellPresenceSnapshot = { presences: [], distances: [], deadline: null };

interface CellPresenceInput {
  rects: readonly GridCellRect[];
  viewportHeight: number;
  focusedIndex: number;
  maximizedIndex: number | null;
}

function samePresences(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Presence of every grid cell. Scroll is read by one rAF-throttled handler on the grid's scroll
 * signal and the offset is never React state: the deck re-renders only when some cell changes
 * presence. A timer wakes the deck when an off-screen cell is due to turn hidden, because no
 * scroll event arrives while the user stands still.
 *
 * Render only previews the presences. The tracker records what it saw (and the clock reading)
 * in a layout effect or a handler, so a discarded render cannot move the hidden delay.
 */
export function useCellPresences(
  input: CellPresenceInput & {
    deckRef: RefObject<View | null>;
    signal: GridScrollSignal;
    enabled: boolean;
  },
): CellPresenceSnapshot {
  const { deckRef, signal, enabled, rects, viewportHeight, focusedIndex, maximizedIndex } = input;
  const trackerRef = useRef<CellPresenceTracker | null>(null);
  trackerRef.current ??= new CellPresenceTracker();
  const tracker = trackerRef.current;
  const scrollTopRef = useRef(0);
  const [version, rerender] = useReducer((count: number) => count + 1, 0);

  // `version` only forces a new preview after a handler recorded a change.
  const snapshot = useMemo(
    () =>
      enabled
        ? tracker.preview({
            rects,
            scrollTop: scrollTopRef.current,
            viewportHeight,
            focusedIndex,
            maximizedIndex,
            now: Date.now(),
          })
        : NO_CELLS,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version is a re-preview trigger
    [enabled, tracker, rects, viewportHeight, focusedIndex, maximizedIndex, version],
  );

  const latestRef = useRef<CellPresenceInput>({
    rects,
    viewportHeight,
    focusedIndex,
    maximizedIndex,
  });
  const snapshotRef = useRef(snapshot);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reevaluate = useCallback(() => {
    const latest = latestRef.current;
    const node: unknown = deckRef.current;
    if (isWeb && node instanceof HTMLElement) {
      scrollTopRef.current = node.scrollTop;
    }
    const next = tracker.evaluate({
      rects: latest.rects,
      scrollTop: scrollTopRef.current,
      viewportHeight: latest.viewportHeight,
      focusedIndex: latest.focusedIndex,
      maximizedIndex: latest.maximizedIndex,
      now: Date.now(),
    });
    const changed = !samePresences(next.presences, snapshotRef.current.presences);
    snapshotRef.current = next;
    clearTimer();
    if (next.deadline !== null) {
      timerRef.current = setTimeout(
        () => {
          timerRef.current = null;
          reevaluate();
        },
        Math.max(0, next.deadline - Date.now()) + 1,
      );
    }
    if (changed) {
      rerender();
    }
  }, [clearTimer, deckRef, tracker]);

  // Record the observation the render previewed. The preview already matches it, so this
  // re-renders only when the clock moved a cell across the hidden delay in between.
  useLayoutEffect(() => {
    latestRef.current = { rects, viewportHeight, focusedIndex, maximizedIndex };
    snapshotRef.current = snapshot;
    if (enabled) {
      reevaluate();
    }
  }, [enabled, focusedIndex, maximizedIndex, rects, reevaluate, snapshot, viewportHeight]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let frame: number | null = null;
    const unsubscribe = signal.subscribe(() => {
      if (frame !== null) {
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = null;
        reevaluate();
      });
    });
    return () => {
      unsubscribe();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [enabled, reevaluate, signal]);

  useEffect(() => {
    if (!enabled) {
      clearTimer();
    }
    return clearTimer;
  }, [enabled, clearTimer]);

  return snapshot;
}
