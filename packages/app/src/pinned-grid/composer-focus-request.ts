/** How long a request waits for the target composer to become active. */
export const COMPOSER_FOCUS_REQUEST_TTL_MS = 1000;

let expiresAt: number | null = null;

/**
 * Asks for the composer of the cell that is about to take grid focus to receive editor focus.
 * The cell has not rendered as focused yet when a keyboard move runs, so the request waits until
 * the composer of the new cell becomes active. Time limits it, so a cell that never shows a
 * composer does not pull focus later.
 */
export function requestComposerFocus(now: number = Date.now()): void {
  expiresAt = now + COMPOSER_FOCUS_REQUEST_TTL_MS;
}

/** Drops a waiting request. */
export function cancelComposerFocusRequest(): void {
  expiresAt = null;
}

/** Returns true once for a request that is still valid. */
export function takeComposerFocusRequest(now: number = Date.now()): boolean {
  const valid = expiresAt !== null && now < expiresAt;
  expiresAt = null;
  return valid;
}
