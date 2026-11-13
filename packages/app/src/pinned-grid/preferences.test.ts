import { describe, expect, it } from "vitest";
import {
  DEFAULT_PINNED_GRID_PREFERENCES,
  normalizeRowScales,
  PinnedGridPreferencesSchema,
} from "./preferences";
import {
  APP_SETTINGS_KEY,
  DEFAULT_CLIENT_SETTINGS,
  loadAppSettingsFromStorage,
} from "@/hooks/use-settings/storage";
import { createFakeDesktopBridge, createInMemoryKeyValueStorage } from "@/hooks/use-settings/fakes";

describe("PinnedGridPreferencesSchema", () => {
  it("gives the defaults when nothing is stored", () => {
    expect(PinnedGridPreferencesSchema.parse(undefined)).toEqual(DEFAULT_PINNED_GRID_PREFERENCES);
    expect(DEFAULT_PINNED_GRID_PREFERENCES.mode).toBe("normal");
  });

  it("merges a partial value with the defaults", () => {
    const parsed = PinnedGridPreferencesSchema.parse({ mode: "3" });
    expect(parsed.mode).toBe("3");
    expect(parsed.columnRatios).toEqual(DEFAULT_PINNED_GRID_PREFERENCES.columnRatios);
    expect(parsed.rowScales).toEqual(DEFAULT_PINNED_GRID_PREFERENCES.rowScales);
  });

  it("keeps valid stored column ratios normalized to sum to 1", () => {
    const parsed = PinnedGridPreferencesSchema.parse({ columnRatios: { "2": [1, 3] } });
    expect(parsed.columnRatios["2"][0]).toBeCloseTo(0.25);
    expect(parsed.columnRatios["2"][1]).toBeCloseTo(0.75);
  });

  it("repairs malformed values instead of throwing", () => {
    const parsed = PinnedGridPreferencesSchema.parse({
      mode: "4",
      columnRatios: { "2": "x", "3": [null, -1, "a"] },
      rowScales: { "2": [null, -1, 1e9, 1], "3": 7 },
    });
    expect(parsed.mode).toBe("normal");
    expect(parsed.columnRatios["2"]).toHaveLength(2);
    expect(parsed.columnRatios["3"]).toHaveLength(3);
    for (const ratios of [parsed.columnRatios["2"], parsed.columnRatios["3"]]) {
      expect(ratios.every(Number.isFinite)).toBe(true);
      expect(ratios.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    }
    expect(parsed.rowScales["2"]).toEqual([0.05, 20, 1]);
    expect(parsed.rowScales["3"]).toEqual([]);
  });

  it("falls back to the defaults for a non-object value", () => {
    expect(PinnedGridPreferencesSchema.parse(42)).toEqual(DEFAULT_PINNED_GRID_PREFERENCES);
    expect(PinnedGridPreferencesSchema.parse(null)).toEqual(DEFAULT_PINNED_GRID_PREFERENCES);
  });
});

describe("normalizeRowScales", () => {
  it("keeps finite values and clamps them to the allowed range", () => {
    expect(normalizeRowScales([1, 0.01, 50, 1.5, 0.2])).toEqual([1, 0.05, 20, 1.5, 0.2]);
  });

  it("drops values that are not finite numbers", () => {
    expect(normalizeRowScales([null, "2", Number.NaN, Infinity, 2])).toEqual([2]);
  });
});

describe("stored app settings", () => {
  function makeDeps() {
    return { storage: createInMemoryKeyValueStorage(), desktop: createFakeDesktopBridge() };
  }

  it("loads settings from the current release with grid mode normal", async () => {
    const deps = makeDeps();
    await deps.storage.setItem(APP_SETTINGS_KEY, JSON.stringify({ vimKeybindings: true }));
    const settings = await loadAppSettingsFromStorage(deps);
    expect(settings.pinnedGrid).toEqual(DEFAULT_PINNED_GRID_PREFERENCES);
    expect(settings.vimKeybindings).toBe(true);
    expect(DEFAULT_CLIENT_SETTINGS.pinnedGrid.mode).toBe("normal");
  });

  it("keeps the other preferences when the stored grid value is malformed", async () => {
    for (const pinnedGrid of [42, "x", [], { mode: 9, columnRatios: null, rowScales: [1] }]) {
      const deps = makeDeps();
      await deps.storage.setItem(
        APP_SETTINGS_KEY,
        JSON.stringify({ vimKeybindings: true, chatOutlineEnabled: false, pinnedGrid }),
      );
      const settings = await loadAppSettingsFromStorage(deps);
      expect(settings.vimKeybindings).toBe(true);
      expect(settings.chatOutlineEnabled).toBe(false);
      expect(settings.pinnedGrid).toEqual(DEFAULT_PINNED_GRID_PREFERENCES);
    }
  });
});
