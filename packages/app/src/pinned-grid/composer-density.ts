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
 * A composer in a grid cell shrinks to one slim line while the user is not using it.
 * It stays full when it is outside a grid, when its cell is maximized, while it holds
 * focus, and whenever there is something to lose: a draft or attachments.
 */
export function resolveComposerDensity(input: ComposerDensityInput): ComposerDensity {
  if (!input.inGridCell || input.maximized) return "full";
  if (input.inputFocused || input.hasDraft || input.hasAttachments) return "full";
  return "minimal";
}
