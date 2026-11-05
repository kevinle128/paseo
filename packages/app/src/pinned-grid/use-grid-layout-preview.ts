import { useCallback, useState } from "react";
import type { PinnedGridColumnMode, PinnedGridPreferences } from "./preferences";

/**
 * Column ratios and row scales of the active grid mode. A divider drag previews in local state and
 * writes to the stored preferences once on release, so a drag does not rewrite settings per frame.
 */
export function useGridLayoutPreview(input: {
  preferences: PinnedGridPreferences;
  modeKey: PinnedGridColumnMode;
  updatePreferences: (updates: Partial<PinnedGridPreferences>) => Promise<void>;
}) {
  const { preferences, modeKey, updatePreferences } = input;
  const [preview, setPreview] = useState<{
    columnRatios: number[] | null;
    rowScales: number[] | null;
  }>({ columnRatios: null, rowScales: null });

  const previewColumnRatios = useCallback(
    (ratios: number[]) => setPreview((current) => ({ ...current, columnRatios: ratios })),
    [],
  );
  const previewRowScales = useCallback(
    (scales: number[]) => setPreview((current) => ({ ...current, rowScales: scales })),
    [],
  );
  const commitColumnRatios = useCallback(
    (ratios: number[]) => {
      setPreview((current) => ({ ...current, columnRatios: null }));
      void updatePreferences({ columnRatios: { ...preferences.columnRatios, [modeKey]: ratios } });
    },
    [modeKey, preferences.columnRatios, updatePreferences],
  );
  const commitRowScales = useCallback(
    (scales: number[]) => {
      setPreview((current) => ({ ...current, rowScales: null }));
      void updatePreferences({ rowScales: { ...preferences.rowScales, [modeKey]: scales } });
    },
    [modeKey, preferences.rowScales, updatePreferences],
  );
  const resetColumnRatios = useCallback(() => {
    const columns = modeKey === "3" ? 3 : 2;
    commitColumnRatios(Array.from({ length: columns }, () => 1 / columns));
  }, [commitColumnRatios, modeKey]);
  const resetRowScales = useCallback(() => commitRowScales([]), [commitRowScales]);

  return {
    columnRatios: preview.columnRatios ?? preferences.columnRatios[modeKey],
    rowScales: preview.rowScales ?? preferences.rowScales[modeKey],
    previewColumnRatios,
    previewRowScales,
    commitColumnRatios,
    commitRowScales,
    resetColumnRatios,
    resetRowScales,
  };
}
