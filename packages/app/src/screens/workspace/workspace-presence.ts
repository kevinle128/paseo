/**
 * How a mounted workspace relates to the screen.
 * - focused: on screen and owns keyboard input, document title and host-level focus.
 * - reduced: on screen, keeps live data, but never owns input.
 * - hidden: mounted but off screen.
 *
 * A plain string keeps `memo` comparisons on the workspace screen cheap.
 */
export type WorkspacePresence = "focused" | "reduced" | "hidden";

export const isPresented = (presence: WorkspacePresence): boolean => presence !== "hidden";

export const ownsInput = (presence: WorkspacePresence): boolean => presence === "focused";

export const singlePresence = (active: boolean): WorkspacePresence =>
  active ? "focused" : "hidden";
