import { useMemo } from "react";

import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import SettingsScreen from "@/screens/settings-screen";

/** A plugin directory listing's page, by its `owner/slug` ID. */
export default function PluginListingRoute() {
  const { serverId, owner, slug, source } = useLocalSearchParams<{
    serverId: string;
    owner: string;
    slug: string;
    source?: string;
  }>();
  const rawSource = Array.isArray(source) ? source[0] : source;
  const pluginSource: "fork" | undefined = rawSource === "fork" ? "fork" : undefined;
  const view = useMemo(
    () => ({
      kind: "pluginListing" as const,
      serverId,
      listingId: `${owner}/${slug}`,
      ...(pluginSource ? { source: pluginSource } : {}),
    }),
    [serverId, owner, slug, pluginSource],
  );
  return (
    <HostRouteBootstrapBoundary>
      <SettingsScreen view={view} />
    </HostRouteBootstrapBoundary>
  );
}
