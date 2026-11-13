import { describe, expect, it } from "vitest";
import {
  isGridCell,
  isSlimComposerCell,
  resolveComposerDensity,
  resolvePressHold,
  type ComposerDensityInput,
} from "./composer-density";

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

describe("grid cell predicates", () => {
  it("isGridCell is true for any cell, maximized or not", () => {
    expect(isGridCell(null)).toBe(false);
    expect(isGridCell({ isMaximized: true })).toBe(true);
    expect(isGridCell({ isMaximized: false })).toBe(true);
  });

  it("isSlimComposerCell is true only for a cell that is not maximized", () => {
    expect(isSlimComposerCell(null)).toBe(false);
    expect(isSlimComposerCell({ isMaximized: true })).toBe(false);
    expect(isSlimComposerCell({ isMaximized: false })).toBe(true);
  });
});

describe("resolvePressHold", () => {
  const none = { insideTextInput: false, insidePlaceholder: false };

  it("never holds for a press outside the composer", () => {
    for (const density of ["full", "minimal"] as const) {
      expect(
        resolvePressHold({
          insideRoot: false,
          density,
          insideTextInput: true,
          insidePlaceholder: true,
        }),
      ).toBe(false);
    }
  });

  it("holds a full composer for any press inside it", () => {
    expect(resolvePressHold({ insideRoot: true, density: "full", ...none })).toBe(true);
  });

  it("expands a minimal composer from the text surface or the placeholder only", () => {
    expect(resolvePressHold({ insideRoot: true, density: "minimal", ...none })).toBe(false);
    expect(
      resolvePressHold({
        insideRoot: true,
        density: "minimal",
        insideTextInput: true,
        insidePlaceholder: false,
      }),
    ).toBe(true);
    expect(
      resolvePressHold({
        insideRoot: true,
        density: "minimal",
        insideTextInput: false,
        insidePlaceholder: true,
      }),
    ).toBe(true);
  });
});
