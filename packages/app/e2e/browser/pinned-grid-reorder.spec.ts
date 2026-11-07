import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { recordAgentRequests } from "../support/helpers/agent-requests";
import { seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { pinWorkspaceFromSidebar } from "../support/helpers/sidebar";
import {
  switchWorkspaceViaSidebar,
  waitForWorkspaceInSidebar,
} from "../support/helpers/workspace-ui";

const DECK_ENTRY_SELECTOR = '[data-testid^="workspace-deck-entry-"]';
const DECK_MARK_PROPERTY = "__deckMark";
const PIN_SHORTCUT = "ControlOrMeta+Shift+P";

interface Seeded {
  workspaceId: string;
  client: { setWorkspacePinned(id: string, pinned: boolean): Promise<unknown> };
  cleanup(): Promise<void>;
}

function cellLocator(page: Page, serverId: string, workspaceId: string): Locator {
  return page.getByTestId(`pinned-grid-cell-${serverId}:${workspaceId}`);
}

function indicator(page: Page): Locator {
  return page.getByTestId("pinned-grid-drop-indicator");
}

async function chooseGridMode(page: Page, mode: "normal" | "2" | "3"): Promise<void> {
  await page.locator(`[data-testid="sidebar-pinned-grid-mode-${mode}"]:visible`).first().click();
}

async function box(locator: Locator) {
  const result = await locator.boundingBox();
  if (!result) throw new Error("element has no box");
  return result;
}

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const rect = await box(locator);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

async function readCellOrder<T extends { workspaceId: string }>(
  page: Page,
  serverId: string,
  workspaces: T[],
): Promise<string[]> {
  const placed = await Promise.all(
    workspaces.map(async (workspace) => {
      const rect = await box(cellLocator(page, serverId, workspace.workspaceId));
      return { id: workspace.workspaceId, x: rect.x, y: rect.y };
    }),
  );
  placed.sort((a, b) => a.y - b.y || a.x - b.x);
  return placed.map((entry) => entry.id);
}

async function readSidebarPinnedIds(page: Page): Promise<string[]> {
  const testIds = await page
    .getByTestId("sidebar-pinned-section")
    .locator('[data-testid^="sidebar-workspace-row-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid") ?? ""));
  return testIds.map((id) => id.replace(`sidebar-workspace-row-${getServerId()}:`, ""));
}

async function readDeckScrollTop(page: Page): Promise<number> {
  return page
    .getByTestId("workspace-deck")
    .evaluate((node) => (node instanceof HTMLElement ? node.scrollTop : -1));
}

async function markDeckEntries(page: Page): Promise<void> {
  await page.evaluate(
    ({ selector, property }) => {
      document.querySelectorAll(selector).forEach((node) => {
        (node as unknown as Record<string, string>)[property] =
          node.getAttribute("data-testid") ?? "";
      });
    },
    { selector: DECK_ENTRY_SELECTOR, property: DECK_MARK_PROPERTY },
  );
}

// A remounted entry renders a fresh node that lost its mark.
async function expectNoDeckEntryRemounted(page: Page): Promise<void> {
  const readings = await page.evaluate(
    ({ selector, property }) =>
      Array.from(document.querySelectorAll(selector)).map((node) => ({
        testId: node.getAttribute("data-testid") ?? "",
        mark: (node as unknown as Record<string, string | undefined>)[property] ?? null,
      })),
    { selector: DECK_ENTRY_SELECTOR, property: DECK_MARK_PROPERTY },
  );
  expect(readings.length).toBeGreaterThan(0);
  for (const reading of readings) {
    expect(reading.mark, `entry ${reading.testId} kept its node`).toBe(reading.testId);
  }
}

async function pinInOrder(workspaces: Seeded[]): Promise<void> {
  for (const workspace of workspaces) {
    await workspace.client.setWorkspacePinned(workspace.workspaceId, true);
  }
}

async function openGrid(
  page: Page,
  serverId: string,
  pinned: Seeded[],
  others: Seeded[] = [],
): Promise<void> {
  await gotoAppShell(page);
  for (const workspace of [...pinned, ...others]) {
    await waitForWorkspaceInSidebar(page, { serverId, workspaceId: workspace.workspaceId });
  }
  // Pinning after the app loaded keeps the stored order empty, so cells follow the pin order. Pins
  // that exist at load are ordered newest first once, to match the old sidebar.
  await pinInOrder(pinned);
  await switchWorkspaceViaSidebar({ page, serverId, workspaceId: pinned[0].workspaceId });
  await chooseGridMode(page, "2");
  for (const workspace of pinned) {
    await expect(cellLocator(page, serverId, workspace.workspaceId)).toBeVisible({
      timeout: 30_000,
    });
  }
}

async function expectOrders(
  page: Page,
  serverId: string,
  workspaces: Seeded[],
  expected: Seeded[],
): Promise<void> {
  const ids = expected.map((workspace) => workspace.workspaceId);
  await expect.poll(() => readCellOrder(page, serverId, workspaces)).toEqual(ids);
  await expect.poll(() => readSidebarPinnedIds(page)).toEqual(ids);
}

// Presses on a cell title and drags to the target point; the caller releases the mouse.
async function dragTitleTo(
  page: Page,
  cell: Locator,
  target: { x: number; y: number },
): Promise<void> {
  const from = await center(cell.getByTestId("workspace-header-title"));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 10 });
}

test.describe("Pinned grid reorder", () => {
  test.describe.configure({ timeout: 300_000 });

  test("drags a cell to a slot, updates the sidebar on drop and keeps the order after reload", async ({
    page,
  }) => {
    const serverId = getServerId();
    const [a, b, c] = [
      await seedWorkspace({ repoPrefix: "grid-drag-a-" }),
      await seedWorkspace({ repoPrefix: "grid-drag-b-" }),
      await seedWorkspace({ repoPrefix: "grid-drag-c-" }),
    ];
    const all = [a, b, c];
    await page.setViewportSize({ width: 1500, height: 1000 });
    try {
      await openGrid(page, serverId, all);
      await expectOrders(page, serverId, all, all);
      await markDeckEntries(page);

      const cellC = cellLocator(page, serverId, c.workspaceId);
      await dragTitleTo(page, cellLocator(page, serverId, a.workspaceId), await center(cellC));
      await expect(indicator(page)).toBeVisible();
      // The sidebar keeps its order until the drop.
      expect(await readSidebarPinnedIds(page)).toEqual(all.map((w) => w.workspaceId));
      await page.mouse.up();

      await expect(indicator(page)).toHaveCount(0);
      await expectOrders(page, serverId, all, [b, c, a]);
      await expectNoDeckEntryRemounted(page);

      await page.reload();
      await expect(cellLocator(page, serverId, a.workspaceId)).toBeVisible({ timeout: 30_000 });
      await expectOrders(page, serverId, all, [b, c, a]);
    } finally {
      for (const workspace of all) await workspace.cleanup();
    }
  });

  test("a header double-click maximizes and a press on a header button starts no drag", async ({
    page,
  }) => {
    const serverId = getServerId();
    const [a, b] = [
      await seedWorkspace({ repoPrefix: "grid-dbl-a-" }),
      await seedWorkspace({ repoPrefix: "grid-dbl-b-" }),
    ];
    await page.setViewportSize({ width: 1500, height: 900 });
    try {
      await openGrid(page, serverId, [a, b]);
      const cellA = cellLocator(page, serverId, a.workspaceId);

      const button = await center(cellA.getByTestId("workspace-grid-cell-maximize"));
      await page.mouse.move(button.x, button.y);
      await page.mouse.down();
      await page.mouse.move(button.x - 80, button.y + 120, { steps: 10 });
      await expect(indicator(page)).toHaveCount(0);
      await page.mouse.up();

      await cellA.getByTestId("workspace-header-title").dblclick();
      await expect(cellLocator(page, serverId, b.workspaceId)).toBeHidden();
      await expect(indicator(page)).toHaveCount(0);
    } finally {
      await b.cleanup();
      await a.cleanup();
    }
  });

  test("auto-scrolls at the bottom and top edges", async ({ page }) => {
    const serverId = getServerId();
    const pinned: Seeded[] = [];
    await page.setViewportSize({ width: 1500, height: 700 });
    try {
      for (let index = 0; index < 6; index += 1) {
        pinned.push(await seedWorkspace({ repoPrefix: `grid-scroll-${index}-` }));
      }
      await openGrid(page, serverId, pinned);
      expect(await readDeckScrollTop(page)).toBe(0);

      const deck = await box(page.getByTestId("workspace-deck"));
      await dragTitleTo(page, cellLocator(page, serverId, pinned[0].workspaceId), {
        x: deck.x + deck.width / 2,
        y: deck.y + deck.height - 8,
      });
      await expect.poll(() => readDeckScrollTop(page)).toBeGreaterThan(40);
      const scrolledDown = await readDeckScrollTop(page);

      await page.mouse.move(deck.x + deck.width / 2, deck.y + 8, { steps: 10 });
      await expect.poll(() => readDeckScrollTop(page)).toBeLessThan(scrolledDown);
      await page.mouse.up();
    } finally {
      for (const workspace of pinned) await workspace.cleanup();
    }
  });

  test("Escape cancels a drag without interrupting the agent, and interrupts outside a drag", async ({
    page,
  }) => {
    const serverId = getServerId();
    const running = await seedMockAgentWorkspace({
      repoPrefix: "grid-esc-run-",
      title: "Grid escape running",
      model: "one-minute-stream",
      initialPrompt: "stream for a while",
    });
    const [b, c] = [
      await seedWorkspace({ repoPrefix: "grid-esc-b-" }),
      await seedWorkspace({ repoPrefix: "grid-esc-c-" }),
    ];
    const all: Seeded[] = [running, b, c];
    await page.setViewportSize({ width: 2200, height: 1000 });
    const requests = await recordAgentRequests(page);
    try {
      await openGrid(page, serverId, all);
      await expectOrders(page, serverId, all, all);
      const runningCell = cellLocator(page, serverId, running.workspaceId);

      await dragTitleTo(
        page,
        runningCell,
        await center(cellLocator(page, serverId, c.workspaceId)),
      );
      await expect(indicator(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(indicator(page)).toHaveCount(0);
      await page.mouse.up();

      await expectOrders(page, serverId, all, all);
      expect(requests.cancelRequests(running.agentId)).toBe(0);
      await page.reload();
      await expect(runningCell).toBeVisible({ timeout: 30_000 });
      await expectOrders(page, serverId, all, all);
      expect(requests.cancelRequests(running.agentId)).toBe(0);

      // Outside a drag, Escape in the cell still interrupts the agent.
      await runningCell.getByRole("textbox", { name: "Message agent..." }).click();
      await page.keyboard.press("Escape");
      await expect.poll(() => requests.cancelRequests(running.agentId)).toBe(1);
    } finally {
      await c.cleanup();
      await b.cleanup();
      await running.cleanup();
    }
  });

  test("new pins land last in the grid and the sidebar, and a re-pin lands last", async ({
    page,
  }) => {
    const serverId = getServerId();
    const base = [
      await seedWorkspace({ repoPrefix: "grid-pin-a-" }),
      await seedWorkspace({ repoPrefix: "grid-pin-b-" }),
      await seedWorkspace({ repoPrefix: "grid-pin-c-" }),
    ];
    const fourth = await seedWorkspace({ repoPrefix: "grid-pin-d-" });
    const fifth = await seedWorkspace({ repoPrefix: "grid-pin-e-" });
    await page.setViewportSize({ width: 1500, height: 1000 });
    try {
      await openGrid(page, serverId, base, [fourth, fifth]);
      await expectOrders(page, serverId, base, base);

      await pinWorkspaceFromSidebar(page, fourth.workspaceId);
      const withFourth = [...base, fourth];
      await expect(cellLocator(page, serverId, fourth.workspaceId)).toBeVisible({
        timeout: 30_000,
      });
      await expectOrders(page, serverId, withFourth, withFourth);

      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: fifth.workspaceId });
      await page.keyboard.press(PIN_SHORTCUT);
      const withFifth = [...withFourth, fifth];
      await expect(cellLocator(page, serverId, fifth.workspaceId)).toBeVisible({
        timeout: 30_000,
      });
      await expectOrders(page, serverId, withFifth, withFifth);

      // Unpin the second workspace, then pin it again: it goes to the end.
      await pinWorkspaceFromSidebar(page, base[1].workspaceId);
      await expect(cellLocator(page, serverId, base[1].workspaceId)).toHaveCount(0);
      await pinWorkspaceFromSidebar(page, base[1].workspaceId);
      const reordered = [base[0], base[2], fourth, fifth, base[1]];
      await expect(cellLocator(page, serverId, base[1].workspaceId)).toBeVisible({
        timeout: 30_000,
      });
      await expectOrders(page, serverId, withFifth, reordered);
    } finally {
      await fifth.cleanup();
      await fourth.cleanup();
      for (const workspace of base) await workspace.cleanup();
    }
  });
});
