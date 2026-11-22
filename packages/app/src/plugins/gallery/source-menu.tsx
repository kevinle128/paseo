import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { PluginSourceKind } from "@getpaseo/protocol/fork-plugin-source";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";

const SOURCES = ["paseo", "fork"] as const satisfies readonly PluginSourceKind[];

function SourceOption({
  source,
  selected,
  label,
  onChange,
}: {
  source: PluginSourceKind;
  selected: boolean;
  label: string;
  onChange(source: PluginSourceKind): void;
}) {
  const select = useCallback(() => onChange(source), [onChange, source]);
  return (
    <DropdownMenuItem selected={selected} onSelect={select} testID={`plugin-source-${source}`}>
      {label}
    </DropdownMenuItem>
  );
}

/** Source filter for Browse and Installed: the public Paseo registry, or the fork registry. */
export function PluginSourceMenu({
  value,
  onChange,
}: {
  value: PluginSourceKind;
  onChange(value: PluginSourceKind): void;
}) {
  const { t } = useTranslation();
  const label = t("settings.plugins.gallery.source.label");
  const selected = t(`settings.plugins.gallery.source.${value}`);
  return (
    <DropdownMenu>
      <DropdownTrigger
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected}`}
        testID="plugin-source"
      >
        {selected}
      </DropdownTrigger>
      <DropdownMenuContent side="bottom" align="start" width={220} sheetTitle={label}>
        {SOURCES.map((source) => (
          <SourceOption
            key={source}
            source={source}
            selected={source === value}
            label={t(`settings.plugins.gallery.source.${source}`)}
            onChange={onChange}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
