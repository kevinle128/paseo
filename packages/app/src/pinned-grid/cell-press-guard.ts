/**
 * Remembers whether the latest pointer-down is the one that moved focus into a cell. A press
 * that completes from that same pointer gesture only focuses the cell and must not act.
 */
export interface PointerFocusClaim {
  /** Records the latest pointer-down. `focusChanged` is true when it moved focus into the cell. */
  pointerDown(focusChanged: boolean): void;
  /** Marks the pointer gesture as finished. The claim itself ends on `release`. */
  pointerEnd(): void;
  /** A key was pressed. It ends the claim only when no pointer gesture is in progress. */
  keyDown(): void;
  /** Ends the claim. */
  release(): void;
  isClaimed(): boolean;
}

export function createPointerFocusClaim(): PointerFocusClaim {
  let claimed = false;
  let pointerActive = false;
  return {
    pointerDown(focusChanged) {
      claimed = focusChanged;
      pointerActive = true;
    },
    pointerEnd() {
      pointerActive = false;
    },
    // A key pressed during the gesture (a keyboard click on the focused control) must not make a
    // press that started on an unfocused cell act.
    keyDown() {
      if (!pointerActive) {
        claimed = false;
      }
    },
    release() {
      claimed = false;
      pointerActive = false;
    },
    isClaimed() {
      return claimed;
    },
  };
}

/**
 * Consequential controls act only when the cell was already focused before this press. Outside a
 * grid cell there is nothing to guard.
 */
export function shouldRunGuardedPress(input: {
  inGridCell: boolean;
  cellIsFocused: boolean;
  pointerFocusedCell: boolean;
}): boolean {
  if (!input.inGridCell) {
    return true;
  }
  return input.cellIsFocused && !input.pointerFocusedCell;
}
