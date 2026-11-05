import { createContext, useContext } from "react";
import type { PointerFocusClaim } from "./cell-press-guard";

export interface WorkspaceGridCell {
  isFocused: boolean;
  isMaximized: boolean;
  /** The cell header shows the project as a badge because the cell has no project group above it. */
  showProjectBadge: boolean;
  toggleMaximize: () => void;
  focusCell: () => void;
  pointerFocusClaim: PointerFocusClaim;
}

// Null in Normal mode, so every consumer renders exactly what it rendered before the grid existed.
const WorkspaceGridCellContext = createContext<WorkspaceGridCell | null>(null);

export const WorkspaceGridCellProvider = WorkspaceGridCellContext.Provider;

export function useWorkspaceGridCell(): WorkspaceGridCell | null {
  return useContext(WorkspaceGridCellContext);
}
