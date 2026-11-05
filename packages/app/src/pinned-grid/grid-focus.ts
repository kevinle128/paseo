export interface GridFocusState {
  focusedKey: string | null;
}

export type GridFocusEvent =
  | { type: "pointer-down"; key: string }
  | { type: "route-changed"; key: string }
  | { type: "cells-changed"; keys: string[] };

export const INITIAL_GRID_FOCUS: GridFocusState = { focusedKey: null };

/**
 * Which grid cell owns input. It is local state that changes in the same commit as the pointer
 * or focus event, so a key pressed right after a click already goes to the clicked cell. The
 * route follows afterwards and is only an input here: a sidebar click arrives as `route-changed`.
 * The reducer returns the same object when nothing changes so React skips the render.
 */
export function reduceGridFocus(state: GridFocusState, event: GridFocusEvent): GridFocusState {
  switch (event.type) {
    case "pointer-down":
    case "route-changed":
      return state.focusedKey === event.key ? state : { focusedKey: event.key };
    case "cells-changed":
      if (state.focusedKey === null || event.keys.includes(state.focusedKey)) {
        return state;
      }
      return INITIAL_GRID_FOCUS;
  }
}
