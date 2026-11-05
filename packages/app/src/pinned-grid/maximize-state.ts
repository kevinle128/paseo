export interface MaximizeState {
  maximizedKey: string | null;
}

export type MaximizeEvent =
  | { type: "toggle"; key: string }
  | { type: "route-changed"; key: string }
  | { type: "cells-changed"; keys: string[] };

export const INITIAL_MAXIMIZE_STATE: MaximizeState = { maximizedKey: null };

/**
 * Which grid cell fills the whole grid area. Moving the route to another cell (a sidebar click on
 * another pinned chat) or removing the maximized cell from the grid restores the grid.
 */
export function reduceMaximize(state: MaximizeState, event: MaximizeEvent): MaximizeState {
  switch (event.type) {
    case "toggle":
      return state.maximizedKey === event.key
        ? INITIAL_MAXIMIZE_STATE
        : { maximizedKey: event.key };
    case "route-changed":
      return state.maximizedKey === null || state.maximizedKey === event.key
        ? state
        : INITIAL_MAXIMIZE_STATE;
    case "cells-changed":
      return state.maximizedKey === null || event.keys.includes(state.maximizedKey)
        ? state
        : INITIAL_MAXIMIZE_STATE;
  }
}
