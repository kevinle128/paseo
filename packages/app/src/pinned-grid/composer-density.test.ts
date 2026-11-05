import { describe, expect, it } from "vitest";
import { resolveComposerDensity, type ComposerDensityInput } from "./composer-density";

const BOOLEAN_KEYS = [
  "inGridCell",
  "maximized",
  "inputFocused",
  "hasDraft",
  "hasAttachments",
] as const satisfies readonly (keyof ComposerDensityInput)[];

function inputFromBits(bits: number): ComposerDensityInput {
  const [inGridCell, maximized, inputFocused, hasDraft, hasAttachments] = BOOLEAN_KEYS.map(
    (_key, index) => Boolean(bits & (1 << index)),
  );
  return {
    inGridCell: inGridCell ?? false,
    maximized: maximized ?? false,
    inputFocused: inputFocused ?? false,
    hasDraft: hasDraft ?? false,
    hasAttachments: hasAttachments ?? false,
  };
}

describe("resolveComposerDensity", () => {
  it("is minimal only for an idle, empty composer in a cell that is not maximized", () => {
    for (let bits = 0; bits < 1 << BOOLEAN_KEYS.length; bits += 1) {
      const input = inputFromBits(bits);
      const expectMinimal =
        input.inGridCell &&
        !input.maximized &&
        !input.inputFocused &&
        !input.hasDraft &&
        !input.hasAttachments;
      expect(resolveComposerDensity(input), JSON.stringify(input)).toBe(
        expectMinimal ? "minimal" : "full",
      );
    }
  });

  it("collapses an idle empty composer in a grid cell", () => {
    expect(
      resolveComposerDensity({
        inGridCell: true,
        maximized: false,
        inputFocused: false,
        hasDraft: false,
        hasAttachments: false,
      }),
    ).toBe("minimal");
  });

  it("stays full outside a grid cell", () => {
    expect(
      resolveComposerDensity({
        inGridCell: false,
        maximized: false,
        inputFocused: false,
        hasDraft: false,
        hasAttachments: false,
      }),
    ).toBe("full");
  });
});
