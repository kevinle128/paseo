/**
 * @vitest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { createPointerFocusClaim } from "./cell-press-guard";
import { WorkspaceGridCellProvider, type WorkspaceGridCell } from "./grid-cell-context";
import { useGuardedCellPress } from "./use-guarded-cell-press";

function cellValue(overrides: Partial<WorkspaceGridCell> = {}): WorkspaceGridCell {
  return {
    isFocused: false,
    isMaximized: false,
    showProjectBadge: true,
    toggleMaximize: vi.fn(),
    focusCell: vi.fn(),
    pointerFocusClaim: createPointerFocusClaim(),
    ...overrides,
  };
}

function renderGuarded(onPress: () => void, cell: WorkspaceGridCell | null) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    cell ? createElement(WorkspaceGridCellProvider, { value: cell }, children) : children;
  return renderHook(() => useGuardedCellPress(onPress), { wrapper });
}

describe("useGuardedCellPress", () => {
  it("passes the press through in Normal mode", () => {
    const onPress = vi.fn();
    const { result } = renderGuarded(onPress, null);

    result.current();

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("only focuses an unfocused cell on the first press, and acts on the second", () => {
    const onPress = vi.fn();
    const claim = createPointerFocusClaim();
    const cell = cellValue({ isFocused: false, pointerFocusClaim: claim });
    const first = renderGuarded(onPress, cell);

    claim.pointerDown(true);
    first.result.current();
    claim.release();

    expect(onPress).not.toHaveBeenCalled();
    expect(cell.focusCell).toHaveBeenCalledTimes(1);

    const focusedCell = cellValue({ isFocused: true, pointerFocusClaim: claim });
    const second = renderGuarded(onPress, focusedCell);
    claim.pointerDown(false);
    second.result.current();

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("swallows the press from the pointer that focused the cell even after the render", () => {
    const onPress = vi.fn();
    const claim = createPointerFocusClaim();
    const cell = cellValue({ isFocused: true, pointerFocusClaim: claim });
    const { result } = renderGuarded(onPress, cell);

    claim.pointerDown(true);
    result.current();

    expect(onPress).not.toHaveBeenCalled();
    expect(cell.focusCell).not.toHaveBeenCalled();
  });

  it("does not act when a key is pressed between the pointer-down and the press", () => {
    const onPress = vi.fn();
    const claim = createPointerFocusClaim();
    const unfocused = cellValue({ isFocused: false, pointerFocusClaim: claim });
    const first = renderGuarded(onPress, unfocused);

    claim.pointerDown(true);
    claim.keyDown();
    first.result.current();

    expect(onPress).not.toHaveBeenCalled();

    // The cell has committed its focus by the time the press arrives.
    const focused = cellValue({ isFocused: true, pointerFocusClaim: claim });
    const second = renderGuarded(onPress, focused);
    second.result.current();

    expect(onPress).not.toHaveBeenCalled();
  });

  it("acts on the first press in a cell that is already focused", () => {
    const onPress = vi.fn();
    const claim = createPointerFocusClaim();
    const cell = cellValue({ isFocused: true, pointerFocusClaim: claim });
    const { result } = renderGuarded(onPress, cell);

    claim.pointerDown(false);
    result.current();

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does not act on a keyboard activation in an unfocused cell", () => {
    const onPress = vi.fn();
    const cell = cellValue({ isFocused: false });
    const { result } = renderGuarded(onPress, cell);

    result.current();

    expect(onPress).not.toHaveBeenCalled();
    expect(cell.focusCell).toHaveBeenCalledTimes(1);
  });
});
