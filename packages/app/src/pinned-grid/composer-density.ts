export type ComposerDensity = "full" | "minimal";

export interface ComposerDensityInput {
  inGridCell: boolean;
  maximized: boolean;
  inputFocused: boolean;
  hasDraft: boolean;
  hasAttachments: boolean;
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
