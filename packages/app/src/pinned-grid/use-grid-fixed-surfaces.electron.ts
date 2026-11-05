import { useEffect, type RefObject } from "react";
import type { View } from "react-native";
import {
  repositionPresentedBrowserWebviews,
  setBrowserWebviewViewportClip,
} from "@/desktop/browser/resident-webviews";
import type { GridScrollSignal } from "./grid-scroll-signal";

/**
 * Electron browser webviews are fixed-position, so scrolling the grid does not move them. While
 * the grid shows, they clip to its visible area and are placed again on every scroll.
 */
export function useGridFixedSurfaces(input: {
  deckRef: RefObject<View | null>;
  isGrid: boolean;
  signal: GridScrollSignal;
}): void {
  const { deckRef, isGrid, signal } = input;
  useEffect(() => {
    const node: unknown = deckRef.current;
    if (!isGrid || !(node instanceof HTMLElement)) {
      return undefined;
    }
    setBrowserWebviewViewportClip(() => signal.getViewportRect());
    const unsubscribe = signal.subscribe(repositionPresentedBrowserWebviews);
    repositionPresentedBrowserWebviews();
    return () => {
      unsubscribe();
      setBrowserWebviewViewportClip(null);
      repositionPresentedBrowserWebviews();
    };
  }, [deckRef, isGrid, signal]);
}
