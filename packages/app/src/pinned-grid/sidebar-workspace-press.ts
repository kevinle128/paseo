import type { PinnedGridMode } from "./preferences";

export interface SidebarWorkspacePressInput {
  mode: PinnedGridMode;
  supportsGrid: boolean;
  focusModeEnabled: boolean;
  isPinned: boolean;
}

/**
 * A press on a pinned row while the grid shows only focuses the cell that is already on screen.
 * Navigating would open tabs and reveal panels, which changes what a visible cell shows.
 */
export function resolveSidebarWorkspacePress(
  input: SidebarWorkspacePressInput,
): "focus-cell" | "navigate" {
  if (input.mode === "normal" || !input.supportsGrid || input.focusModeEnabled) return "navigate";
  return input.isPinned ? "focus-cell" : "navigate";
}
