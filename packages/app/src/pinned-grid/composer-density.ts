export type ComposerDensity = "full" | "minimal";

export interface ComposerDensityInput {
  inGridCell: boolean;
  maximized: boolean;
  inputFocused: boolean;
  hasDraft: boolean;
  hasAttachments: boolean;
}

interface GridCellLike {
  isMaximized: boolean;
}

/** True in any grid cell, maximized or not. Focus never moves into a cell composer on its own. */
export function isGridCell(cell: GridCellLike | null): boolean {
  return cell !== null;
}

/** True in a grid cell that is not maximized, the only place the composer can be slim. */
export function isSlimComposerCell(cell: GridCellLike | null): boolean {
  return cell !== null && !cell.isMaximized;
}

/**
 * A composer in a grid cell hides its text surface while the user is not using it. The toolbar
 * stays where it is, and an inline placeholder in the toolbar stands in for the text surface.
 * It stays full when it is outside a grid, when its cell is maximized, while it holds
 * focus, and whenever there is something to lose: a draft or attachments.
 */
export function resolveComposerDensity(input: ComposerDensityInput): ComposerDensity {
  if (!input.inGridCell || input.maximized) return "full";
  if (input.inputFocused || input.hasDraft || input.hasAttachments) return "full";
  return "minimal";
}

/**
 * Whether a pointer press keeps the composer expanded. A press outside the composer never holds
 * it. While full, any press inside holds it so toolbar menus keep their anchor. While minimal,
 * only a press in the text surface or the inline placeholder expands it, so pressing the other
 * toolbar controls only focuses the cell.
 */
export function resolvePressHold(input: {
  insideRoot: boolean;
  density: ComposerDensity;
  insideTextInput: boolean;
  insidePlaceholder: boolean;
}): boolean {
  if (!input.insideRoot) return false;
  if (input.density === "full") return true;
  return input.insideTextInput || input.insidePlaceholder;
}
