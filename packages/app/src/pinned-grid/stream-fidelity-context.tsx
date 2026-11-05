import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ReducedFidelityClock } from "./reduced-fidelity-clock";

/**
 * How closely a workspace follows its agent stream.
 * - full: every committed update renders, text reveals at the paced rate.
 * - reduced: the transcript renders at most once per clock tick and text shows whole.
 */
export type StreamFidelity = "full" | "reduced";

/** One cell's view of the grid clock. Everything in the cell ticks together, on one slot. */
export interface CellTick {
  subscribe(listener: () => void): () => void;
}

interface StreamFidelityValue {
  fidelity: StreamFidelity;
  /** Null outside a reduced cell, where nothing waits for a tick. */
  tick: CellTick | null;
}

const FULL_FIDELITY: StreamFidelityValue = { fidelity: "full", tick: null };

/**
 * Fans one clock subscription out to every listener of a cell. The transcript tail and head of a
 * cell must deliver in the same tick; separate slots could show an item twice or not at all.
 */
export function createCellTick(clock: ReducedFidelityClock): CellTick {
  const listeners = new Set<() => void>();
  let unsubscribe: (() => void) | null = null;
  return {
    subscribe(listener) {
      listeners.add(listener);
      unsubscribe ??= clock.subscribe(() => {
        for (const current of listeners) {
          current();
        }
      });
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unsubscribe?.();
          unsubscribe = null;
        }
      };
    },
  };
}

const StreamFidelityContext = createContext<StreamFidelityValue>(FULL_FIDELITY);

export function StreamFidelityProvider({
  fidelity,
  clock,
  children,
}: {
  fidelity: StreamFidelity;
  clock: ReducedFidelityClock | null;
  children: ReactNode;
}) {
  const value = useMemo<StreamFidelityValue>(
    () =>
      fidelity === "full" || clock === null
        ? FULL_FIDELITY
        : { fidelity, tick: createCellTick(clock) },
    [clock, fidelity],
  );
  return <StreamFidelityContext value={value}>{children}</StreamFidelityContext>;
}

export function useStreamFidelity(): StreamFidelityValue {
  return useContext(StreamFidelityContext);
}
