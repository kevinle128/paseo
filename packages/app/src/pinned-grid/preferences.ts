import { z } from "zod";
import { clampNormalizedSizes } from "@/stores/workspace-layout-actions";

export type PinnedGridMode = "normal" | "2" | "3";
export type PinnedGridColumnMode = Exclude<PinnedGridMode, "normal">;

// Row scales are relative weights that share the rows' total height (see
// `distributeRowHeights`). A divider drag clamps rows in pixels, so the stored bounds only
// reject absurd values and must be wide enough for a clamped drag to survive a reload.
export const MIN_ROW_SCALE = 0.05;
export const MAX_ROW_SCALE = 20;

/** Device-local. Ratios and scales are kept per column count so each mode remembers its sizes. */
export interface PinnedGridPreferences {
  /** "normal" keeps the single-workspace layout, so existing users see no change. */
  mode: PinnedGridMode;
  /** Column width ratios per mode. Each array has one entry per column and sums to 1. */
  columnRatios: Record<PinnedGridColumnMode, number[]>;
  /** Relative row height weights per mode. Empty means every row has the same height. */
  rowScales: Record<PinnedGridColumnMode, number[]>;
}

export const DEFAULT_PINNED_GRID_PREFERENCES: PinnedGridPreferences = {
  mode: "normal",
  columnRatios: { "2": [0.5, 0.5], "3": [1 / 3, 1 / 3, 1 / 3] },
  rowScales: { "2": [], "3": [] },
};

/** Keeps finite numbers only and clamps each to the allowed range. */
export function normalizeRowScales(scales: readonly unknown[]): number[] {
  const result: number[] = [];
  for (const scale of scales) {
    if (typeof scale === "number" && Number.isFinite(scale)) {
      result.push(Math.min(MAX_ROW_SCALE, Math.max(MIN_ROW_SCALE, scale)));
    }
  }
  return result;
}

function columnRatiosSchema(count: number, fallback: number[]) {
  return z
    .array(z.unknown())
    .transform((values) => {
      const sizes = Array.from({ length: count }, (_, index) => {
        const value = values[index];
        return typeof value === "number" ? value : Number.NaN;
      });
      return clampNormalizedSizes(sizes);
    })
    .catch(fallback);
}

function rowScalesSchema() {
  return z
    .array(z.unknown())
    .transform((values) => normalizeRowScales(values))
    .catch([]);
}

// Every field and the whole object fall back to defaults. The app settings schema parses this
// value on load, so a throw here would discard every other stored preference.
export const PinnedGridPreferencesSchema = z
  .object({
    mode: z.enum(["normal", "2", "3"]).catch(DEFAULT_PINNED_GRID_PREFERENCES.mode),
    columnRatios: z
      .object({
        "2": columnRatiosSchema(2, DEFAULT_PINNED_GRID_PREFERENCES.columnRatios["2"]),
        "3": columnRatiosSchema(3, DEFAULT_PINNED_GRID_PREFERENCES.columnRatios["3"]),
      })
      .catch(DEFAULT_PINNED_GRID_PREFERENCES.columnRatios),
    rowScales: z
      .object({ "2": rowScalesSchema(), "3": rowScalesSchema() })
      .catch(DEFAULT_PINNED_GRID_PREFERENCES.rowScales),
  })
  .catch(DEFAULT_PINNED_GRID_PREFERENCES);
