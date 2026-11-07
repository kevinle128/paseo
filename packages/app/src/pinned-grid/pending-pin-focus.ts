export const PENDING_PIN_FOCUS_TTL_MS = 10_000;

export interface PendingPinFocus {
  key: string;
  expiresAt: number;
}

export type PendingPinFocusEvent =
  | { type: "picked"; key: string; now: number }
  | { type: "user-focus" }
  | { type: "pins-changed"; pinnedKeys: readonly string[]; now: number };

export interface PendingPinFocusResult {
  state: PendingPinFocus | null;
  /** The workspace key to focus now. */
  focus?: string;
}

/**
 * Remembers which workspace the user just picked in the "+" picker until the pin shows up in the
 * pinned list, then asks for focus once. A focus change by the user, or the time limit, drops it,
 * so a late pin never pulls focus away from where the user went.
 */
export function reducePendingPinFocus(
  state: PendingPinFocus | null,
  event: PendingPinFocusEvent,
): PendingPinFocusResult {
  switch (event.type) {
    case "picked":
      return { state: { key: event.key, expiresAt: event.now + PENDING_PIN_FOCUS_TTL_MS } };
    case "user-focus":
      return { state: null };
    case "pins-changed": {
      if (!state || event.now >= state.expiresAt) return { state: null };
      if (event.pinnedKeys.includes(state.key)) return { state: null, focus: state.key };
      return { state };
    }
  }
}
