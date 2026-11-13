import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { View } from "react-native";
import { isWeb } from "@/constants/platform";
import {
  resolveComposerDensity,
  resolvePressHold,
  type ComposerDensity,
} from "@/pinned-grid/composer-density";
import { useWorkspaceGridCell } from "@/pinned-grid/grid-cell-context";

interface GridComposerDensityInput {
  rootRef: RefObject<View | null>;
  /** The editable element. A press inside it expands a minimal composer. */
  textInputElement: HTMLElement | null;
  /** The inline placeholder in the toolbar. A press inside it expands a minimal composer. */
  placeholderElement: HTMLElement | null;
  /** Focuses the editor with the caret at the end. Runs once the composer is full and visible. */
  focusEditor: () => void;
  inputFocused: boolean;
  hasDraft: boolean;
  hasAttachments: boolean;
}

interface GridComposerDensity {
  density: ComposerDensity;
  /** Expands a minimal composer and focuses the editor. For presses that bring no pointer-down. */
  requestExpand: () => void;
  /** Ends a press hold, so the composer collapses once it holds no focus, draft or attachment. */
  releaseHold: () => void;
}

/**
 * Density of the composer for the grid cell it sits in. Outside a grid it is always "full".
 *
 * The composer stays expanded while the user works inside it, not only while the text input
 * holds focus: opening a toolbar menu moves focus out of the input, and collapsing then would
 * remove the menu's anchor. A press inside holds the composer open for as long as its cell
 * keeps grid focus, or until a press lands outside it. A minimal composer expands only when the
 * press lands in the text input or the inline placeholder, so pressing the toolbar controls
 * around them only focuses the cell. A press in the placeholder also moves focus to the editor
 * once the composer is full.
 */
export function useGridComposerDensity({
  rootRef,
  textInputElement,
  placeholderElement,
  focusEditor,
  inputFocused,
  hasDraft,
  hasAttachments,
}: GridComposerDensityInput): GridComposerDensity {
  const cell = useWorkspaceGridCell();
  const inGridCell = cell !== null;
  const [pressHold, setPressHold] = useState(false);
  const density = resolveComposerDensity({
    inGridCell,
    maximized: cell?.isMaximized ?? false,
    inputFocused: inputFocused || (pressHold && (cell?.isFocused ?? false)),
    hasDraft,
    hasAttachments,
  });
  const densityRef = useRef(density);
  densityRef.current = density;
  const textInputElementRef = useRef(textInputElement);
  textInputElementRef.current = textInputElement;
  const placeholderElementRef = useRef(placeholderElement);
  placeholderElementRef.current = placeholderElement;
  const focusEditorRef = useRef(focusEditor);
  focusEditorRef.current = focusEditor;
  const focusAfterExpandRef = useRef(false);
  const placeholderPressRef = useRef(false);

  useEffect(() => {
    if (!isWeb || !inGridCell) return;
    const isInside = (container: Element | null, target: EventTarget | null) =>
      Boolean(container && target instanceof Node && container.contains(target));
    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current as unknown as HTMLElement | null;
      const insidePlaceholder = isInside(placeholderElementRef.current, event.target);
      const hold = resolvePressHold({
        insideRoot: isInside(root, event.target),
        density: densityRef.current,
        insideTextInput: isInside(textInputElementRef.current, event.target),
        insidePlaceholder,
      });
      setPressHold(hold);
      placeholderPressRef.current = hold && insidePlaceholder && densityRef.current === "minimal";
      // Every press resets the request, so a press elsewhere cancels a pending focus.
      focusAfterExpandRef.current = hold && insidePlaceholder && densityRef.current === "minimal";
    };
    // The placeholder unmounts as the composer expands, and the browser then runs its default
    // mousedown focus on a detached target, which would blur the editor that just took focus.
    // The pointer-down already unmounted the placeholder, so the flag from that press decides.
    const handleMouseDown = (event: MouseEvent) => {
      if (!placeholderPressRef.current) return;
      placeholderPressRef.current = false;
      event.preventDefault();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("mousedown", handleMouseDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("mousedown", handleMouseDown, true);
    };
  }, [inGridCell, rootRef]);

  useEffect(() => {
    if (density !== "full" || !focusAfterExpandRef.current) return;
    focusAfterExpandRef.current = false;
    focusEditorRef.current();
  }, [density]);

  const requestExpand = useCallback(() => {
    if (densityRef.current !== "minimal") return;
    focusAfterExpandRef.current = true;
    setPressHold(true);
  }, []);

  const releaseHold = useCallback(() => {
    focusAfterExpandRef.current = false;
    setPressHold(false);
  }, []);

  return { density, requestExpand, releaseHold };
}
