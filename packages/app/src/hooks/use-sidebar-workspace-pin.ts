import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/contexts/toast-context";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { removePinnedOrderKey } from "@/pinned-grid/pinned-order-seed";
import { selectPinnedEntries } from "@/pinned-grid/use-pinned-workspace-selections";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

// Everything the pin toggle actually needs. Kept narrower than SidebarWorkspaceEntry so the
// global keyboard handler can build one from the active route selection without a sidebar row.
export type PinnableWorkspace = Pick<
  SidebarWorkspaceEntry,
  "serverId" | "workspaceId" | "workspaceKey" | "pinnedAt"
>;

export type ToggleSidebarWorkspacePin = (workspace: PinnableWorkspace) => void;

// Module scope, not a per-hook ref: the sidebar row menus and the global keyboard shortcut each
// hold their own controller instance, and a per-instance guard would let a keypress and a menu
// click fire two concurrent, opposite setWorkspacePinned calls for the same workspace.
const pendingWorkspaceKeys = new Set<string>();

function removeFromStoredOrder(workspaceKey: string): void {
  const pinnedAtByKey: Record<string, string> = {};
  for (const { serverId, workspaceId, pinnedAt } of selectPinnedEntries(
    useSessionStore.getState().sessions,
  )) {
    pinnedAtByKey[`${serverId}:${workspaceId}`] = pinnedAt;
  }
  removePinnedOrderKey(workspaceKey, pinnedAtByKey);
}

export function useSidebarWorkspacePinController(): ToggleSidebarWorkspacePin {
  const { t } = useTranslation();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: async ({
      workspace,
      pinned,
    }: {
      workspace: PinnableWorkspace;
      pinned: boolean;
    }) => {
      const client = getHostRuntimeStore().getClient(workspace.serverId);
      if (!client) {
        throw new Error(t("sidebar.workspace.toasts.hostDisconnected"));
      }
      await client.setWorkspacePinned(workspace.workspaceId, pinned);
    },
    // A failed unpin keeps the workspace pinned, so it keeps its slot.
    onSuccess: (_data, { workspace, pinned }) => {
      if (!pinned) removeFromStoredOrder(workspace.workspaceKey);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t("sidebar.workspace.toasts.hostDisconnected"),
      );
    },
    onSettled: (_data, _error, { workspace }) => {
      pendingWorkspaceKeys.delete(workspace.workspaceKey);
    },
  });
  const mutate = mutation.mutate;

  return useCallback(
    (workspace: PinnableWorkspace) => {
      if (pendingWorkspaceKeys.has(workspace.workspaceKey)) {
        return;
      }
      pendingWorkspaceKeys.add(workspace.workspaceKey);
      const pinned = workspace.pinnedAt == null;
      // Drop a stale slot before the pin lands, or the new pin first shows at its old position.
      if (pinned) removeFromStoredOrder(workspace.workspaceKey);
      mutate({ workspace, pinned });
    },
    [mutate],
  );
}
