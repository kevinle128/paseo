import { useEffect, useState } from "react";
import { isNative } from "@/constants/platform";
import { CELL_TRANSITION_SETTLE_MS, prefersReducedMotion } from "./cell-transition";

/**
 * Whether a grid cell holds its timeline suspended. A hidden cell is suspended. When a maximize
 * starts or ends while the cell is suspended, it stays suspended until the motion settles, so the
 * catch-up of a returning cell does not run on the main thread during the restore animation.
 * Every other presence change, such as a scroll, applies at once.
 */
export function useSettledCellSuspension(input: {
  hidden: boolean;
  underMaximized: boolean;
}): boolean {
  const { hidden, underMaximized } = input;
  const [seenHidden, setSeenHidden] = useState(hidden);
  const [seenUnder, setSeenUnder] = useState(underMaximized);
  // A new value restarts the hold timer; 0 means no hold.
  const [hold, setHold] = useState(0);
  if (seenHidden !== hidden) {
    setSeenHidden(hidden);
  }
  if (seenUnder !== underMaximized) {
    setSeenUnder(underMaximized);
    const wasSuspended = seenHidden || hold !== 0;
    if (wasSuspended && !isNative && !prefersReducedMotion()) {
      setHold((current) => current + 1);
    }
  }
  useEffect(() => {
    if (hold === 0) {
      return undefined;
    }
    const timer = setTimeout(() => setHold(0), CELL_TRANSITION_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [hold]);
  return hidden || hold !== 0;
}
