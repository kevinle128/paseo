import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { expectAppRoute } from "../support/helpers/route-assertions";
import { getServerId } from "../support/helpers/server-id";
import { waitForWorkspaceInSidebar } from "../support/helpers/workspace-ui";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";

// Heights are far apart on purpose: the slim line is ~40px, the full composer is ~120px.
const MINIMAL_MAX_HEIGHT = 64;
const FULL_MIN_HEIGHT = 80;

interface RecordedAgentRequests {
  modeRequests(agentId: string): string[];
  cancelRequests(agentId: string): number;
  sendRequests(agentId: string): number;
}

function sessionMessage(message: string | Buffer): Record<string, unknown> | null {
  try {
    const envelope = JSON.parse(typeof message === "string" ? message : message.toString("utf8"));
    if (envelope?.type !== "session" || typeof envelope.message !== "object") return null;
    return envelope.message as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Shift+Tab and Escape reach the daemon as these two requests, keyed by agent. They are the
// observable proof of which cell's agent a shortcut acted on.
async function recordAgentRequests(page: Page): Promise<RecordedAgentRequests> {
  const modes: Array<{ agentId: string; modeId: string }> = [];
  const cancels: string[] = [];
  const sends: string[] = [];
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const parsed = sessionMessage(message);
      const agentId = typeof parsed?.agentId === "string" ? parsed.agentId : "";
      if (parsed?.type === "set_agent_mode_request") {
        modes.push({ agentId, modeId: typeof parsed.modeId === "string" ? parsed.modeId : "" });
      } else if (parsed?.type === "cancel_agent_request") {
        cancels.push(agentId);
      } else if (parsed?.type === "send_agent_message_request") {
        sends.push(agentId);
      }
      server.send(message);
    });
    server.onMessage((message) => ws.send(message));
  });
  return {
    modeRequests: (agentId) =>
      modes.filter((entry) => entry.agentId === agentId).map((entry) => entry.modeId),
    cancelRequests: (agentId) => cancels.filter((id) => id === agentId).length,
    sendRequests: (agentId) => sends.filter((id) => id === agentId).length,
  };
}

function cellLocator(page: Page, serverId: string, workspaceId: string): Locator {
  return page.getByTestId(`pinned-grid-cell-${serverId}:${workspaceId}`);
}

function cellComposerInput(cell: Locator): Locator {
  return cell.getByRole("textbox", { name: "Message agent..." });
}

async function composerHeight(cell: Locator): Promise<number> {
  const box = await cell.getByTestId("message-input-root").boundingBox();
  return box?.height ?? 0;
}

test.describe("Minimal composer in pinned grid cells", () => {
  test.describe.configure({ timeout: 240_000 });

  test("a click on an unfocused cell's slim composer takes typing and shortcuts at once", async ({
    page,
  }) => {
    const serverId = getServerId();
    // The first agent streams for a minute, so Escape has something to interrupt.
    const target = await seedMockAgentWorkspace({
      repoPrefix: "grid-composer-a-",
      title: "Grid composer target",
      model: "one-minute-stream",
      initialPrompt: "stream for a while",
    });
    const other = await seedMockAgentWorkspace({
      repoPrefix: "grid-composer-b-",
      title: "Grid composer other",
    });
    // Cells must be wide enough to keep the mode control in the composer toolbar.
    await page.setViewportSize({ width: 2200, height: 900 });
    const requests = await recordAgentRequests(page);

    try {
      for (const workspace of [target, other]) {
        await workspace.client.setWorkspacePinned(workspace.workspaceId, true);
      }
      await openAgentRoute(page, target);
      await expect(cellComposerInput(page.locator("body")).first()).toBeVisible({
        timeout: 30_000,
      });
      const normalHeight = await composerHeight(page.locator("body"));
      expect(normalHeight, "composer height in Normal mode").toBeGreaterThan(FULL_MIN_HEIGHT);

      await openAgentRoute(page, other);
      for (const workspace of [target, other]) {
        await waitForWorkspaceInSidebar(page, { serverId, workspaceId: workspace.workspaceId });
      }
      await page.locator('[data-testid="sidebar-pinned-grid-mode-2"]:visible').first().click();
      const targetCell = cellLocator(page, serverId, target.workspaceId);
      const otherCell = cellLocator(page, serverId, other.workspaceId);
      await expect(targetCell).toBeVisible({ timeout: 30_000 });
      await expect(otherCell).toBeVisible({ timeout: 30_000 });
      await expect(cellComposerInput(targetCell)).toBeVisible({ timeout: 30_000 });
      await expect(cellComposerInput(otherCell)).toBeVisible({ timeout: 30_000 });
      await expect(otherCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(1);

      // The unfocused cell's composer is slim while idle.
      await expect.poll(() => composerHeight(targetCell)).toBeLessThan(MINIMAL_MAX_HEIGHT);

      // Click the unfocused cell's slim composer and type, press Shift+Tab and Escape with no
      // wait in between.
      await cellComposerInput(targetCell).click();
      await page.keyboard.type("typed at once");
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Escape");

      await expect(cellComposerInput(targetCell)).toHaveValue("typed at once");
      await expect(cellComposerInput(otherCell)).toHaveValue("");
      await expect(targetCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(1);
      await expect(otherCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(0);
      await expectAppRoute(page, buildHostWorkspaceRoute(serverId, target.workspaceId));

      await expect.poll(() => requests.modeRequests(target.agentId)).toHaveLength(1);
      await expect.poll(() => requests.cancelRequests(target.agentId)).toBeGreaterThan(0);
      expect(requests.modeRequests(other.agentId)).toEqual([]);
      expect(requests.cancelRequests(other.agentId)).toBe(0);

      // A draft keeps the composer expanded after focus leaves it.
      await otherCell.click({ position: { x: 24, y: 24 } });
      await expect(otherCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(1);
      await expect(cellComposerInput(targetCell)).toHaveValue("typed at once");
      expect(await composerHeight(targetCell)).toBeGreaterThan(FULL_MIN_HEIGHT);

      // Clearing the draft and leaving the cell collapses it again.
      await cellComposerInput(targetCell).click();
      await cellComposerInput(targetCell).fill("");
      await otherCell.click({ position: { x: 24, y: 24 } });
      await expect.poll(() => composerHeight(targetCell)).toBeLessThan(MINIMAL_MAX_HEIGHT);

      // The slim line keeps a small send button. A first press in an unfocused cell sends nothing.
      const slimSend = targetCell.getByTestId("composer-minimal-send");
      await expect(slimSend).toBeVisible();
      const slimSendBox = await slimSend.boundingBox();
      expect(slimSendBox?.width ?? 0).toBeLessThanOrEqual(28);
      await expect(targetCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(0);
      const sendsBefore = requests.sendRequests(target.agentId);
      await slimSend.click({ force: true });
      await expect(cellComposerInput(targetCell)).toHaveValue("");
      expect(requests.sendRequests(target.agentId)).toBe(sendsBefore);
    } finally {
      await other.cleanup();
      await target.cleanup();
    }
  });
});
