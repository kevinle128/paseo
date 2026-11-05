import { useCallback } from "react";
import { useAppSettings } from "@/hooks/use-settings";
import type { PinnedGridPreferences } from "./preferences";

export function usePinnedGridPreferences(): {
  preferences: PinnedGridPreferences;
  updatePreferences: (updates: Partial<PinnedGridPreferences>) => Promise<void>;
} {
  const { settings, updateSettings } = useAppSettings();
  const updatePreferences = useCallback(
    (updates: Partial<PinnedGridPreferences>) =>
      updateSettings((current) => ({ pinnedGrid: { ...current.pinnedGrid, ...updates } })),
    [updateSettings],
  );
  return { preferences: settings.pinnedGrid, updatePreferences };
}
