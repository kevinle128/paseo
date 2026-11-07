import { describe, expect, it } from "vitest";
import { resolveSidebarWorkspacePress } from "./sidebar-workspace-press";

const MODES = ["normal", "2", "3"] as const;

describe("resolveSidebarWorkspacePress", () => {
  it("focuses the cell only for a pinned row while a grid mode shows", () => {
    for (const mode of MODES) {
      for (const supportsGrid of [true, false]) {
        for (const focusModeEnabled of [true, false]) {
          for (const isPinned of [true, false]) {
            const expected =
              mode !== "normal" && supportsGrid && !focusModeEnabled && isPinned
                ? "focus-cell"
                : "navigate";
            expect(
              resolveSidebarWorkspacePress({ mode, supportsGrid, focusModeEnabled, isPinned }),
            ).toBe(expected);
          }
        }
      }
    }
  });
});
