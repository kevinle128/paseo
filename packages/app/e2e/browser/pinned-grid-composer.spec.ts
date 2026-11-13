import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import { recordAgentRequests } from "../support/helpers/agent-requests";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { expectAppRoute } from "../support/helpers/route-assertions";
import { getServerId } from "../support/helpers/server-id";
import { waitForWorkspaceInSidebar } from "../support/helpers/workspace-ui";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";

// Heights are far apart on purpose: the collapsed composer is its toolbar row (~56px), the full composer is ~120px.
const MINIMAL_MAX_HEIGHT = 64;
const FULL_MIN_HEIGHT = 80;

function cellLocator(page: Page, serverId: string, workspaceId: string): Locator {
  return page.getByTestId(`pinned-grid-cell-${serverId}:${workspaceId}`);
}

function cellComposerInput(cell: Locator): Locator {
  return cell.getByRole("textbox", { name: "Message agent..." });
}

// A collapsed composer keeps its toolbar and shows this inline placeholder instead of the editor.
function cellComposerPlaceholder(cell: Locator): Locator {
  return cell.getByTestId("composer-inline-placeholder");
}

async function composerHeight(cell: Locator): Promise<number> {
  const box = await cell.getByTestId("message-input-root").boundingBox();
  return box?.height ?? 0;
}

test.describe("Collapsed composer in pinned grid cells", () => {
  test.describe.configure({ timeout: 240_000 });

  test("a press on an unfocused cell's inline placeholder expands and focuses it; Escape leaves, then interrupts", async ({
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
      await expect(cellComposerPlaceholder(targetCell)).toBeVisible({ timeout: 30_000 });
      await expect(cellComposerPlaceholder(otherCell)).toBeVisible({ timeout: 30_000 });
      await expect(otherCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(1);

      // The unfocused cell's composer is collapsed while idle: it keeps its toolbar and shows the
      // placeholder in place of the editor.
      await expect.poll(() => composerHeight(targetCell)).toBeLessThan(MINIMAL_MAX_HEIGHT);

      // The collapsed composer of a running agent shows Stop. A first press in an unfocused cell
      // only focuses it and sends no interrupt.
      const stop = targetCell.getByRole("button", { name: "Stop agent" });
      await expect(stop).toBeVisible();
      await expect(targetCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(0);
      await stop.click();
      await expect(targetCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(1);
      expect(requests.cancelRequests(target.agentId)).toBe(0);
      await expect.poll(() => composerHeight(targetCell)).toBeLessThan(MINIMAL_MAX_HEIGHT);

      // One press on the placeholder expands the composer and focuses the editor, so the first
      // typed key lands. Shift+Tab then reaches the same cell.
      await cellComposerPlaceholder(targetCell).click();
      await expect(cellComposerInput(targetCell)).toBeFocused();
      await expect.poll(() => composerHeight(targetCell)).toBeGreaterThan(FULL_MIN_HEIGHT);
      await page.keyboard.type("typed at once");
      await page.keyboard.press("Shift+Tab");

      // The first Escape leaves the composer and sends no interrupt; the second one interrupts.
      await page.keyboard.press("Escape");
      await expect(cellComposerInput(targetCell)).not.toBeFocused();
      expect(requests.cancelRequests(target.agentId)).toBe(0);
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
    } finally {
      await other.cleanup();
      await target.cleanup();
    }
  });

  test("a press focuses a cell without expanding its composer; only the inline placeholder expands it", async ({
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
      await expect(cellComposerPlaceholder(firstCell)).toBeVisible({ timeout: 30_000 });
      await expect(secondCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(1);

      const expectFocusOn = async (cell: Locator, other: Locator) => {
        await expect(cell.getByTestId("pinned-grid-focus-ring")).toHaveCount(1);
        await expect(other.getByTestId("pinned-grid-focus-ring")).toHaveCount(0);
        await expect.poll(() => composerHeight(cell)).toBeLessThan(MINIMAL_MAX_HEIGHT);
      };

      // Header, transcript and tab bar each move focus and leave the composer collapsed.
      await firstCell.getByTestId("workspace-header-title").click();
      await expectFocusOn(firstCell, secondCell);
      await secondCell.getByTestId("agent-chat-scroll").click({ position: { x: 40, y: 40 } });
      await expectFocusOn(secondCell, firstCell);
      await firstCell.locator('[data-testid^="workspace-tab-"]').first().click();
      await expectFocusOn(firstCell, secondCell);

      // Focus A, then B, then A: A's composer stays collapsed and holds no DOM focus.
      await secondCell.getByTestId("workspace-header-title").click();
      await firstCell.getByTestId("workspace-header-title").click();
      await expectFocusOn(firstCell, secondCell);
      await expect(cellComposerInput(firstCell)).not.toBeFocused();

      // A press on the toolbar row outside the placeholder does not expand it. The far-left edge
      // of the root is padding.
      await secondCell.getByTestId("message-input-root").click({ position: { x: 2, y: 2 } });
      await expectFocusOn(secondCell, firstCell);
      await expect(cellComposerInput(secondCell)).not.toBeFocused();

      // A sidebar press on a pinned row keeps the composer collapsed.
      await page
        .locator(`[data-testid="sidebar-workspace-row-${serverId}:${first.workspaceId}"]:visible`)
        .first()
        .click();
      await expectFocusOn(firstCell, secondCell);

      // Maximize then restore: collapsed, and the text input holds no DOM focus.
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

      // A press on the placeholder expands the composer and takes the first typed key.
      await cellComposerPlaceholder(secondCell).click();
      await expect.poll(() => composerHeight(secondCell)).toBeGreaterThan(FULL_MIN_HEIGHT);
      await page.keyboard.type("x");
      await expect(cellComposerInput(secondCell)).toHaveValue("x");
    } finally {
      await second.cleanup();
      await first.cleanup();
    }
  });
});
