import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { Pressable, Text } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tooltip, TooltipTrigger } from "./tooltip";

vi.mock("@/constants/platform", () => ({
  isWeb: true,
  isNative: false,
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
}));

vi.mock("@gorhom/portal", () => ({
  Portal: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@gorhom/bottom-sheet", () => ({
  useBottomSheetModalInternal: () => null,
}));

const reanimated = vi.hoisted(() => {
  interface FakeFadeOut {
    reduceMotionV: string;
    reduceMotion(value: string): FakeFadeOut;
  }
  const fadeOuts: FakeFadeOut[] = [];
  return {
    fadeOuts,
    createFadeOut(): FakeFadeOut {
      const fadeOut: FakeFadeOut = {
        reduceMotionV: "system",
        reduceMotion(value) {
          fadeOut.reduceMotionV = value;
          return fadeOut;
        },
      };
      fadeOuts.push(fadeOut);
      return fadeOut;
    },
  };
});

vi.mock("react-native-reanimated", () => ({
  default: {
    View: "div",
  },
  FadeIn: { duration: () => ({}) },
  FadeOut: { duration: () => reanimated.createFadeOut() },
  ReduceMotion: { System: "system", Always: "always", Never: "never" },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (styles: unknown) => styles,
  },
}));

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("navigator", dom.window.navigator);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

function renderTrigger({
  childDisabled,
  onPress,
}: {
  childDisabled: boolean;
  onPress: () => void;
}): void {
  act(() => {
    root?.render(
      <Tooltip>
        <TooltipTrigger asChild>
          <Pressable disabled={childDisabled} onPress={onPress} testID="trigger">
            <Text>Send</Text>
          </Pressable>
        </TooltipTrigger>
      </Tooltip>,
    );
  });
}

function pressTrigger(): void {
  const trigger = container?.querySelector('[data-testid="trigger"]');
  expect(trigger).not.toBeNull();

  act(() => {
    trigger?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}

describe("TooltipTrigger", () => {
  it("keeps an asChild trigger disabled when the child is disabled", () => {
    const onPress = vi.fn();

    renderTrigger({ childDisabled: true, onPress });
    pressTrigger();

    expect(onPress).not.toHaveBeenCalled();
  });

  it("closes without the fade-out when its trigger is pressed, and fades again next time", () => {
    const onPress = vi.fn();
    const onOpenChange = vi.fn();
    const renderOpen = (open: boolean) => {
      act(() => {
        root?.render(
          <Tooltip open={open} onOpenChange={onOpenChange}>
            <TooltipTrigger asChild>
              <Pressable onPress={onPress} testID="trigger">
                <Text>Maximize</Text>
              </Pressable>
            </TooltipTrigger>
          </Tooltip>,
        );
      });
    };

    renderOpen(true);
    const fadeOut = reanimated.fadeOuts.at(-1);
    expect(fadeOut?.reduceMotionV).toBe("system");

    pressTrigger();

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(fadeOut?.reduceMotionV).toBe("always");

    renderOpen(false);
    renderOpen(true);

    expect(reanimated.fadeOuts.at(-1)).toBe(fadeOut);
    expect(fadeOut?.reduceMotionV).toBe("system");
  });

  it("keeps an asChild trigger interactive when the child is not disabled", () => {
    const onPress = vi.fn();

    renderTrigger({ childDisabled: false, onPress });
    pressTrigger();

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
