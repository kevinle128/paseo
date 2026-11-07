import { useEffect, type RefObject } from "react";
import type { View } from "react-native";
import { isWeb } from "@/constants/platform";
import { useWorkspaceGridCell } from "./grid-cell-context";

// Controls the header double-click must leave alone, so a double-click on a button does nothing.
export const HEADER_INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, [role="button"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';

/**
 * A grid cell header maximizes the cell on double-click. Native handlers cannot see nested
 * controls, so the DOM listener skips targets inside interactive elements.
 */
export function useHeaderMaximizeDoubleClick(ref: RefObject<View | null>): void {
  const toggleMaximize = useWorkspaceGridCell()?.toggleMaximize ?? null;
  useEffect(() => {
    const node: unknown = ref.current;
    if (!isWeb || !toggleMaximize || !(node instanceof HTMLElement)) {
      return undefined;
    }
    const handleDoubleClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(HEADER_INTERACTIVE_SELECTOR)) {
        return;
      }
      toggleMaximize();
    };
    node.addEventListener("dblclick", handleDoubleClick);
    return () => node.removeEventListener("dblclick", handleDoubleClick);
  }, [ref, toggleMaximize]);
}
