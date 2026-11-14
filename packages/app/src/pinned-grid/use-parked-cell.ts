import { useState } from "react";

/**
 * Whether a grid cell is parked behind a maximized cell: it was on screen when the maximize
 * started, and it stays parked until the maximize ends. A parked cell keeps its layout while it is
 * hidden, so the restore shows it again without laying out its workspace. A cell that was already
 * hidden when the maximize started stays out of layout, so the maximize never lays it out.
 */
export function useParkedCell(input: { underMaximized: boolean; isPresented: boolean }): boolean {
  const { underMaximized, isPresented } = input;
  const [seenUnder, setSeenUnder] = useState(underMaximized);
  // The presence of the previous render. The render that starts a maximize can see the cell
  // hidden before its fade holds the presence, so it decides from the value before.
  const [seenPresented, setSeenPresented] = useState(isPresented);
  const [parked, setParked] = useState(false);
  if (seenUnder !== underMaximized) {
    setSeenUnder(underMaximized);
    setParked(underMaximized && seenPresented);
  }
  if (seenPresented !== isPresented) {
    setSeenPresented(isPresented);
  }
  return parked && underMaximized;
}
