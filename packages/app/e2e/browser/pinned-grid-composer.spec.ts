import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import { recordAgentRequests } from "../support/helpers/agent-requests";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { expectAppRoute } from "../support/helpers/route-assertions";
import { getServerId } from "../support/helpers/server-id";
import { waitForWorkspaceInSidebar } from "../support/helpers/workspace-ui";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";

// Heights are far apart on purpose: the slim line is ~40px, the full composer is ~120px.
const MINIMAL_MAX_HEIGHT = 64;
const FULL_MIN_HEIGHT = 80;

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

  test("a press focuses a cell without expanding its composer; only the text input expands it", async ({
    page,
  }) => {
    const serverId = getServerId();
    const first = await seedMockAgentWorkspace({
      repoPrefix: "grid-focus-a-",
      title: "Grid focus first",
    });
    const second = await seedMockAgentWorkspace({
      repoPrefix: "grid-focus-b-",
      title: "Grid focus second",
    });
    await page.setViewportSize({ width: 2200, height: 900 });

    try {
      for (const workspace of [first, second]) {
        await workspace.client.setWorkspacePinned(workspace.workspaceId, true);
      }
      await openAgentRoute(page, first);
      await openAgentRoute(page, second);
      for (const workspace of [first, second]) {
        await waitForWorkspaceInSidebar(page, { serverId, workspaceId: workspace.workspaceId });
      }
      await page.locator('[data-testid="sidebar-pinned-grid-mode-2"]:visible').first().click();
      const firstCell = cellLocator(page, serverId, first.workspaceId);
      const secondCell = cellLocator(page, serverId, second.workspaceId);
      await expect(firstCell).toBeVisible({ timeout: 30_000 });
      await expect(secondCell).toBeVisible({ timeout: 30_000 });
      await expect(cellComposerInput(firstCell)).toBeVisible({ timeout: 30_000 });
      await expect(secondCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(1);

      const expectFocusOn = async (cell: Locator, other: Locator) => {
        await expect(cell.getByTestId("pinned-grid-focus-ring")).toHaveCount(1);
        await expect(other.getByTestId("pinned-grid-focus-ring")).toHaveCount(0);
        await expect.poll(() => composerHeight(cell)).toBeLessThan(MINIMAL_MAX_HEIGHT);
      };

      // Header, transcript and tab bar each move focus and leave the composer slim.
      await firstCell.getByTestId("workspace-header-title").click();
      await expectFocusOn(firstCell, secondCell);
      await secondCell.getByTestId("agent-chat-scroll").click({ position: { x: 40, y: 40 } });
      await expectFocusOn(secondCell, firstCell);
      await firstCell.locator('[data-testid^="workspace-tab-"]').first().click();
      await expectFocusOn(firstCell, secondCell);

      // Focus A, then B, then A: A's composer stays slim and holds no DOM focus.
      await secondCell.getByTestId("workspace-header-title").click();
      await firstCell.getByTestId("workspace-header-title").click();
      await expectFocusOn(firstCell, secondCell);
      await expect(cellComposerInput(firstCell)).not.toBeFocused();

      // A press on the slim bar outside the text input does not expand it. The far-left edge of
      // the root is padding: neither the input nor the send press area.
      await secondCell.getByTestId("message-input-root").click({ position: { x: 2, y: 2 } });
      await expectFocusOn(secondCell, firstCell);
      await expect(cellComposerInput(secondCell)).not.toBeFocused();

      // A sidebar press on a pinned row keeps the composer slim.
      await page
        .locator(`[data-testid="sidebar-workspace-row-${serverId}:${first.workspaceId}"]:visible`)
        .first()
        .click();
      await expectFocusOn(firstCell, secondCell);

      // Maximize then restore: slim, and the text input holds no DOM focus.
      await firstCell.getByTestId("workspace-grid-cell-maximize").click();
      await expect(firstCell.getByTestId("workspace-grid-cell-maximize")).toHaveAttribute(
        "aria-label",
        "Restore cell",
      );
      await firstCell.getByTestId("workspace-grid-cell-maximize").click();
      await expect(firstCell.getByTestId("workspace-grid-cell-maximize")).toHaveAttribute(
        "aria-label",
        "Maximize cell",
      );
      await expectFocusOn(firstCell, secondCell);
      await expect(cellComposerInput(firstCell)).not.toBeFocused();

      // A press in the text input expands the composer and takes the first typed key.
      await cellComposerInput(secondCell).click();
      await expect.poll(() => composerHeight(secondCell)).toBeGreaterThan(FULL_MIN_HEIGHT);
      await page.keyboard.type("x");
      await expect(cellComposerInput(secondCell)).toHaveValue("x");
    } finally {
      await second.cleanup();
      await first.cleanup();
    }
  });
});
