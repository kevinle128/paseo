import { useEffect, useLayoutEffect } from "react";
import { useNavigation } from "expo-router/react-navigation";
import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { useDirectoryDemand } from "@/hooks/use-directory-demand";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { WorkspaceDeck } from "@/screens/workspace/workspace-deck";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import {
  decodeWorkspaceIdFromPathSegment,
  parseWorkspaceOpenIntent,
  type WorkspaceOpenIntent,
} from "@/utils/host-routes";
import {
  replaceBrowserRouteWithCanonicalHostWorkspaceRoute,
  stripHostWorkspaceRouteEchoSearchFromBrowserUrlAfterCommit,
} from "@/utils/host-route-browser";
import { prepareWorkspaceTab } from "@/utils/prepare-workspace-tab";
import { isWeb } from "@/constants/platform";

function getParamValue(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const firstValue = value[0];
    return typeof firstValue === "string" ? firstValue.trim() : "";
  }
  return "";
}

function getOpenIntentTarget(openIntent: WorkspaceOpenIntent): WorkspaceTabTarget {
  if (openIntent.kind === "agent") {
    return { kind: "agent", agentId: openIntent.agentId };
  }
  if (openIntent.kind === "terminal") {
    return { kind: "terminal", terminalId: openIntent.terminalId };
  }
  if (openIntent.kind === "file") {
    return { kind: "file", path: openIntent.path };
  }
  if (openIntent.kind === "setup") {
    return { kind: "setup", workspaceId: openIntent.workspaceId };
  }
  return { kind: "draft", draftId: openIntent.draftId };
}

// COMPAT(workspace-open-url): added in v0.12.0, remove after 2027-01-22.
// Bookmarks and older clients still send ?open=; internal navigation uses pending model state.
function stripOpenSearchParamFromBrowserUrl() {
  if (!isWeb || typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  if (!url.searchParams.has("open")) {
    return;
  }
  url.searchParams.delete("open");
  replaceBrowserRouteWithCanonicalHostWorkspaceRoute(`${url.pathname}${url.search}${url.hash}`);
}

function clearConsumedOpenIntent(input: {
  navigation: { setParams: (params: { open?: string | undefined }) => void };
}) {
  input.navigation.setParams({ open: undefined });
  if (isWeb) {
    // Expo commits the incoming browser URL after setParams. Strip the consumed legacy input
    // after that commit so it cannot be restored into the address bar and replayed on reload.
    window.setTimeout(stripOpenSearchParamFromBrowserUrl, 0);
  }
}

export default function HostWorkspaceIndexRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <HostWorkspaceRouteContent />
    </HostRouteBootstrapBoundary>
  );
}

function HostWorkspaceRouteContent() {
  const navigation = useNavigation();
  const params = useLocalSearchParams<{
    serverId?: string | string[];
    workspaceId?: string | string[];
    open?: string | string[];
  }>();
  const serverId = getParamValue(params.serverId);
  const workspaceValue = getParamValue(params.workspaceId);
  const workspaceId = workspaceValue
    ? (decodeWorkspaceIdFromPathSegment(workspaceValue) ?? "")
    : "";
  const openValue = getParamValue(params.open);
  // A restored workspace with no open chat has nothing else demanding its host's directory on a
  // phone, where the sidebar only demands while its panel is active. Without demand the deck
  // waits on workspace hydration that never starts.
  useDirectoryDemand(serverId);
  useEffect(() => {
    if (!serverId || !workspaceId) {
      return;
    }
    stripHostWorkspaceRouteEchoSearchFromBrowserUrlAfterCommit();
  }, [serverId, workspaceId]);

  useLayoutEffect(() => {
    if (!openValue || !serverId || !workspaceId) return;
    const openIntent = parseWorkspaceOpenIntent(openValue);
    if (openIntent) {
      prepareWorkspaceTab(
        {
          serverId,
          workspaceId,
          target: getOpenIntentTarget(openIntent),
          pin: openIntent.kind === "agent",
        },
        { openTab: useWorkspaceLayoutStore.getState().deferOpenTab },
      );
    }
    clearConsumedOpenIntent({
      navigation: navigation as unknown as {
        setParams: (params: { open?: string | undefined }) => void;
      },
    });
  }, [navigation, openValue, serverId, workspaceId]);

  return <WorkspaceDeck />;
}
