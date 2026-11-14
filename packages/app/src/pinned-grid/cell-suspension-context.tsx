import { createContext, useContext } from "react";

const CellSuspensionContext = createContext(false);

/**
 * True while the grid cell around a workspace has its live streams released: the cell is hidden,
 * or parked behind a maximized cell. A parked cell keeps a reduced presence so that the restore
 * does not render its workspace again, so stream owners outside the timeline (the terminal) read
 * this in addition to the presence. False outside a grid cell.
 */
export const CellSuspensionProvider = CellSuspensionContext;

export function useIsCellSuspended(): boolean {
  return useContext(CellSuspensionContext);
}
