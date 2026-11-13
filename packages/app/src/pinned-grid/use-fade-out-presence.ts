import { useEffect, useState } from "react";
import type { WorkspacePresence } from "@/screens/workspace/workspace-presence";
import { isNative } from "@/constants/platform";
import { CELL_TRANSITION_SETTLE_MS, prefersReducedMotion } from "./cell-transition";

/**
 * Keeps the last shown presence for the fade time after a cell goes hidden because another cell is
 * maximized. The content stays on screen while the frame fades, then the cell hides at once.
 */
export function useFadeOutPresence(
  presence: WorkspacePresence,
  fadesWhenHidden: boolean,
): WorkspacePresence {
  const [seen, setSeen] = useState(presence);
  const [held, setHeld] = useState<WorkspacePresence | null>(null);
  if (seen !== presence) {
    setSeen(presence);
    const fades = fadesWhenHidden && presence === "hidden" && seen !== "hidden";
    setHeld(fades && !isNative && !prefersReducedMotion() ? seen : null);
  }
  useEffect(() => {
    if (held === null) {
      return undefined;
    }
    const timer = setTimeout(() => setHeld(null), CELL_TRANSITION_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [held]);
  return held ?? presence;
}
