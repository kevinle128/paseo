import type { ActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import type { PinnedGridMode } from "./preferences";

export type DeckPresentation =
  | { kind: "single" }
  | {
      kind: "grid";
      columns: 2 | 3;
      cells: ActiveWorkspaceSelection[];
      focused: ActiveWorkspaceSelection;
    };

const SINGLE: DeckPresentation = { kind: "single" };

function isSameSelection(a: ActiveWorkspaceSelection, b: ActiveWorkspaceSelection): boolean {
  return a.serverId === b.serverId && a.workspaceId === b.workspaceId;
}

/**
 * Decides between the single-workspace layout and the pinned grid. Pure on purpose: every
 * input arrives as a value so the policy can be tested without React or stores.
 *
 * The grid shows only while the active workspace is itself pinned; opening an unpinned
 * workspace leaves the grid and shows that workspace alone.
 */
export function resolveDeckPresentation(input: {
  mode: PinnedGridMode;
  supportsGrid: boolean;
  focusModeEnabled: boolean;
  activeSelection: ActiveWorkspaceSelection | null;
  pinnedSelections: ActiveWorkspaceSelection[];
}): DeckPresentation {
  const { mode, supportsGrid, focusModeEnabled, activeSelection, pinnedSelections } = input;
  if (mode === "normal" || !supportsGrid || focusModeEnabled || !activeSelection) {
    return SINGLE;
  }
  const focused = pinnedSelections.find((selection) => isSameSelection(selection, activeSelection));
  if (!focused) {
    return SINGLE;
  }
  return {
    kind: "grid",
    columns: mode === "2" ? 2 : 3,
    cells: pinnedSelections,
    focused,
  };
}
