import type { RefObject } from "react";
import type { View } from "react-native";
import type { GridScrollSignal } from "./grid-scroll-signal";

/**
 * Keeps surfaces that sit outside the grid's scroll container in step with it. Only Electron has
 * such a surface in the deck (browser webviews), so the base module does nothing.
 */
export function useGridFixedSurfaces(_input: {
  deckRef: RefObject<View | null>;
  isGrid: boolean;
  signal: GridScrollSignal;
}): void {}
