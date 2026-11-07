import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { expectAppRoute } from "../support/helpers/route-assertions";
import { getServerId } from "../support/helpers/server-id";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  switchWorkspaceViaSidebar,
  waitForWorkspaceInSidebar,
} from "../support/helpers/workspace-ui";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";

const DECK_ENTRY_SELECTOR = '[data-testid^="workspace-deck-entry-"]';
const DECK_MARK_PROPERTY = "__deckMark";

interface DeckEntryReading {
  testId: string;
  mark: string | null;
}

// Marks every deck entry node that has no mark yet, with the prefix of the pass. A remounted
// entry renders a fresh node, so a later pass gives it a different prefix than the first one.
async function markNewDeckEntries(page: Page, markPrefix: string): Promise<void> {
  await page.evaluate(
    ({ selector, property, prefix }) => {
      document.querySelectorAll(selector).forEach((node) => {
        const record = node as unknown as Record<string, string | undefined>;
        if (!record[property]) {
          record[property] = `${prefix}:${node.getAttribute("data-testid") ?? ""}`;
        }
      });
    },
    { selector: DECK_ENTRY_SELECTOR, property: DECK_MARK_PROPERTY, prefix: markPrefix },
  );
}

async function readDeckEntries(page: Page): Promise<DeckEntryReading[]> {
  return page.evaluate(
    ({ selector, property }) =>
      Array.from(document.querySelectorAll(selector)).map((node) => ({
        testId: node.getAttribute("data-testid") ?? "",
        mark: (node as unknown as Record<string, string | undefined>)[property] ?? null,
      })),
    { selector: DECK_ENTRY_SELECTOR, property: DECK_MARK_PROPERTY },
  );
}

async function expectEntriesKeepMarks(
  page: Page,
  expectedPrefixByTestId: Record<string, string>,
): Promise<void> {
  const readings = await readDeckEntries(page);
  const observed = JSON.stringify(readings);
  for (const [testId, prefix] of Object.entries(expectedPrefixByTestId)) {
    const matches = readings.filter((reading) => reading.testId === testId);
    expect(matches, `one node for ${testId}: ${observed}`).toHaveLength(1);
    expect(matches[0]?.mark, `mark kept for ${testId}: ${observed}`).toBe(`${prefix}:${testId}`);
  }
}

async function chooseGridMode(page: Page, mode: "normal" | "2" | "3"): Promise<void> {
  await page.locator(`[data-testid="sidebar-pinned-grid-mode-${mode}"]:visible`).first().click();
}

async function cellContainsDomFocus(
  page: Page,
  serverId: string,
  workspaceId: string,
): Promise<boolean> {
  return page.evaluate((testId) => {
    const cell = document.querySelector(`[data-testid="${testId}"]`);
    return Boolean(cell && document.activeElement && cell.contains(document.activeElement));
  }, `pinned-grid-cell-${serverId}:${workspaceId}`);
}

function cellLocator(page: Page, serverId: string, workspaceId: string) {
  return page.getByTestId(`pinned-grid-cell-${serverId}:${workspaceId}`);
}

test.describe("Pinned grid in the workspace deck", () => {
  test.describe.configure({ timeout: 240_000 });

  test("keeps every deck entry mounted across single, grid, focus mode and back", async ({
    page,
  }) => {
    const serverId = getServerId();
    const first = await seedWorkspace({ repoPrefix: "grid-deck-a-" });
    const second = await seedWorkspace({ repoPrefix: "grid-deck-b-" });
    const third = await seedWorkspace({ repoPrefix: "grid-deck-c-" });
    const workspaces = [first, second, third];
    // The first workspace is mounted before the grid, so it must keep its first mark.
    const expectedMarks = Object.fromEntries(
      workspaces.map((workspace, index) => [
        `workspace-deck-entry-${serverId}:${workspace.workspaceId}`,
        index === 0 ? "initial" : "grid",
      ]),
    );

    try {
      for (const workspace of workspaces) {
        await workspace.client.setWorkspacePinned(workspace.workspaceId, true);
      }
      await gotoAppShell(page);
      for (const workspace of workspaces) {
        await waitForWorkspaceInSidebar(page, { serverId, workspaceId: workspace.workspaceId });
      }
      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: first.workspaceId });
      await markNewDeckEntries(page, "initial");

      await chooseGridMode(page, "2");
      for (const workspace of workspaces) {
        await expect(cellLocator(page, serverId, workspace.workspaceId)).toBeVisible({
          timeout: 30_000,
        });
      }
      await markNewDeckEntries(page, "grid");
      await expectEntriesKeepMarks(page, expectedMarks);

      await chooseGridMode(page, "normal");
      await expect(cellLocator(page, serverId, first.workspaceId)).toHaveCount(0);
      await expectEntriesKeepMarks(page, expectedMarks);

      await chooseGridMode(page, "2");
      await expect(cellLocator(page, serverId, second.workspaceId)).toBeVisible();

      // Focus mode shows only the focused cell and returns to the grid without remounting.
      await page.keyboard.press("ControlOrMeta+Shift+F");
      await expect(cellLocator(page, serverId, second.workspaceId)).toHaveCount(0);
      await expectEntriesKeepMarks(page, expectedMarks);
      await page.keyboard.press("ControlOrMeta+Shift+F");
      await expect(cellLocator(page, serverId, second.workspaceId)).toBeVisible();
      await expectEntriesKeepMarks(page, expectedMarks);
    } finally {
      for (const workspace of workspaces.toReversed()) {
        await workspace.cleanup();
      }
    }
  });

  test("a click on a cell focuses it, and a sidebar click keeps the grid with that cell focused", async ({
    page,
  }) => {
    const serverId = getServerId();
    const first = await seedWorkspace({ repoPrefix: "grid-focus-a-" });
    const second = await seedWorkspace({ repoPrefix: "grid-focus-b-" });
    const workspaces = [first, second];

    try {
      for (const workspace of workspaces) {
        await workspace.client.setWorkspacePinned(workspace.workspaceId, true);
      }
      await gotoAppShell(page);
      for (const workspace of workspaces) {
        await waitForWorkspaceInSidebar(page, { serverId, workspaceId: workspace.workspaceId });
      }
      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: first.workspaceId });
      await chooseGridMode(page, "2");
      const firstCell = cellLocator(page, serverId, first.workspaceId);
      const secondCell = cellLocator(page, serverId, second.workspaceId);
      await expect(firstCell).toBeVisible({ timeout: 30_000 });
      await expect(secondCell).toBeVisible({ timeout: 30_000 });
      await expect(firstCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(1);

      await secondCell.click({ position: { x: 24, y: 24 } });
      await expectAppRoute(page, buildHostWorkspaceRoute(serverId, second.workspaceId));
      await expect(secondCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(1);
      await expect(firstCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(0);

      // Keyboard focus inside the focused cell, then a sidebar click on the other cell: typed
      // characters must not stay with the previous cell.
      await secondCell.locator('[tabindex="0"]').first().focus();
      await expect(secondCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(1);

      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: first.workspaceId });
      await expect(firstCell).toBeVisible();
      await expect(secondCell).toBeVisible();
      await expect(firstCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(1);
      await expect(secondCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(0);
      await expect.poll(() => cellContainsDomFocus(page, serverId, second.workspaceId)).toBe(false);

      // A keyboard workspace shortcut moves the route without any pointer, so DOM focus stays
      // where it was unless the cell releases it.
      await firstCell.locator('[tabindex="0"]').first().focus();
      await expect(firstCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(1);
      await page.keyboard.press("Alt+]");
      await expect(secondCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(1);
      await expect(firstCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(0);
      await expect.poll(() => cellContainsDomFocus(page, serverId, first.workspaceId)).toBe(false);
    } finally {
      for (const workspace of workspaces.toReversed()) {
        await workspace.cleanup();
      }
    }
  });

  test("unpinning the focused cell keeps the grid and focuses its neighbor, and the last unpin leaves it", async ({
    page,
  }) => {
    const serverId = getServerId();
    const first = await seedWorkspace({ repoPrefix: "grid-unpin-a-" });
    const second = await seedWorkspace({ repoPrefix: "grid-unpin-b-" });
    const third = await seedWorkspace({ repoPrefix: "grid-unpin-c-" });
    const workspaces = [first, second, third];

    try {
      // Cells run from the most recently pinned, so the cell order is third, second, first.
      for (const workspace of workspaces) {
        await workspace.client.setWorkspacePinned(workspace.workspaceId, true);
      }
      await gotoAppShell(page);
      for (const workspace of workspaces) {
        await waitForWorkspaceInSidebar(page, { serverId, workspaceId: workspace.workspaceId });
      }
      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: second.workspaceId });
      await chooseGridMode(page, "3");
      for (const workspace of workspaces) {
        await expect(cellLocator(page, serverId, workspace.workspaceId)).toBeVisible({
          timeout: 30_000,
        });
      }
      await markNewDeckEntries(page, "grid");
      const entryId = (workspaceId: string) => `workspace-deck-entry-${serverId}:${workspaceId}`;
      await expect(
        cellLocator(page, serverId, second.workspaceId).getByTestId("pinned-grid-focus-ring"),
      ).toHaveCount(1);

      // The focused middle cell leaves the grid: the grid stays and the next cell takes focus.
      await second.client.setWorkspacePinned(second.workspaceId, false);
      await expect(cellLocator(page, serverId, second.workspaceId)).toHaveCount(0);
      await expect(cellLocator(page, serverId, third.workspaceId)).toBeVisible();
      await expect(cellLocator(page, serverId, first.workspaceId)).toBeVisible();
      await expectAppRoute(page, buildHostWorkspaceRoute(serverId, first.workspaceId));
      await expect(
        cellLocator(page, serverId, first.workspaceId).getByTestId("pinned-grid-focus-ring"),
      ).toHaveCount(1);
      await expect(
        cellLocator(page, serverId, third.workspaceId).getByTestId("pinned-grid-focus-ring"),
      ).toHaveCount(0);
      await expectEntriesKeepMarks(page, {
        [entryId(third.workspaceId)]: "grid",
        [entryId(first.workspaceId)]: "grid",
      });

      // The last cell has no cell after it, so focus goes to the one before.
      await first.client.setWorkspacePinned(first.workspaceId, false);
      await expect(cellLocator(page, serverId, first.workspaceId)).toHaveCount(0);
      await expectAppRoute(page, buildHostWorkspaceRoute(serverId, third.workspaceId));
      await expect(cellLocator(page, serverId, third.workspaceId)).toBeVisible();

      // No pinned workspace is left, so the workspace shows alone.
      await third.client.setWorkspacePinned(third.workspaceId, false);
      await expect(cellLocator(page, serverId, third.workspaceId)).toHaveCount(0);
      await expectAppRoute(page, buildHostWorkspaceRoute(serverId, third.workspaceId));
      await expectEntriesKeepMarks(page, { [entryId(third.workspaceId)]: "grid" });
    } finally {
      for (const workspace of workspaces.toReversed()) {
        await workspace.cleanup();
      }
    }
  });

  test("maximizes a cell from the header button, a header double-click and the keyboard", async ({
    page,
  }) => {
    const serverId = getServerId();
    const first = await seedWorkspace({ repoPrefix: "grid-max-a-" });
    const second = await seedWorkspace({ repoPrefix: "grid-max-b-" });
    const workspaces = [first, second];

    try {
      for (const workspace of workspaces) {
        await workspace.client.setWorkspacePinned(workspace.workspaceId, true);
      }
      await gotoAppShell(page);
      for (const workspace of workspaces) {
        await waitForWorkspaceInSidebar(page, { serverId, workspaceId: workspace.workspaceId });
      }
      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: first.workspaceId });
      await markNewDeckEntries(page, "initial");
      await chooseGridMode(page, "2");
      const firstCell = cellLocator(page, serverId, first.workspaceId);
      const secondCell = cellLocator(page, serverId, second.workspaceId);
      await expect(firstCell).toBeVisible({ timeout: 30_000 });
      await expect(secondCell).toBeVisible({ timeout: 30_000 });
      await markNewDeckEntries(page, "grid");
      const expectedMarks = {
        [`workspace-deck-entry-${serverId}:${first.workspaceId}`]: "initial",
        [`workspace-deck-entry-${serverId}:${second.workspaceId}`]: "grid",
      };

      // Header button.
      await secondCell.getByTestId("workspace-grid-cell-maximize").click();
      await expect(firstCell).toBeHidden();
      await expect(secondCell).toBeVisible();

      // Escape is Interrupt agent and never restores the grid.
      await page.keyboard.press("Escape");
      await expect(firstCell).toBeHidden();

      // Keyboard restores.
      await page.keyboard.press("ControlOrMeta+Shift+Enter");
      await expect(firstCell).toBeVisible();
      await expect(secondCell).toBeVisible();

      // Double-click on the header title maximizes, and again restores.
      await secondCell.getByTestId("workspace-header-title").dblclick();
      await expect(firstCell).toBeHidden();
      await secondCell.getByTestId("workspace-header-title").dblclick();
      await expect(firstCell).toBeVisible();

      // A sidebar click on the other pinned chat restores the grid and focuses that cell.
      await secondCell.getByTestId("workspace-grid-cell-maximize").click();
      await expect(firstCell).toBeHidden();
      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: first.workspaceId });
      await expect(firstCell).toBeVisible();
      await expect(secondCell).toBeVisible();
      await expect(firstCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(1);

      await expectEntriesKeepMarks(page, expectedMarks);
    } finally {
      for (const workspace of workspaces.toReversed()) {
        await workspace.cleanup();
      }
    }
  });
});
