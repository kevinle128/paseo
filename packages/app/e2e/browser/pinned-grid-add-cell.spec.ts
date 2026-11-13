import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { recordAgentRequests } from "../support/helpers/agent-requests";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { expectAppRoute } from "../support/helpers/route-assertions";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import {
  switchWorkspaceViaSidebar,
  waitForWorkspaceInSidebar,
} from "../support/helpers/workspace-ui";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";

const PIN_REJECTION_MESSAGE = "Pin rejected by test.";
const PENDING_FOCUS_WINDOW_MS = 11_000;

interface Seeded {
  workspaceId: string;
  client: { setWorkspacePinned(id: string, pinned: boolean): Promise<unknown> };
  cleanup(): Promise<void>;
}

function cellLocator(page: Page, serverId: string, workspaceId: string): Locator {
  return page.getByTestId(`pinned-grid-cell-${serverId}:${workspaceId}`);
}

function addCell(page: Page): Locator {
  return page.getByTestId("pinned-grid-add-cell");
}

function addOption(page: Page, serverId: string, workspaceId: string): Locator {
  return page.getByTestId(`pinned-grid-add-option-${serverId}:${workspaceId}`);
}

async function chooseGridMode(page: Page, mode: "normal" | "2" | "3"): Promise<void> {
  await page.locator(`[data-testid="sidebar-pinned-grid-mode-${mode}"]:visible`).first().click();
}

async function box(locator: Locator) {
  const result = await locator.boundingBox();
  if (!result) throw new Error("element has no box");
  return result;
}

// The cells in slot order, read from where they are drawn: DOM order is not slot order.
async function readCellOrder<T extends { workspaceId: string }>(
  page: Page,
  serverId: string,
  workspaces: T[],
): Promise<T[]> {
  const placed = await Promise.all(
    workspaces.map(async (workspace) => {
      const rect = await box(cellLocator(page, serverId, workspace.workspaceId));
      return { workspace, x: rect.x, y: rect.y };
    }),
  );
  placed.sort((a, b) => a.y - b.y || a.x - b.x);
  return placed.map((entry) => entry.workspace);
}

async function readTestIds(locator: Locator): Promise<string[]> {
  return locator.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-testid") ?? ""),
  );
}

async function isScrollable(locator: Locator): Promise<boolean> {
  return locator.evaluate((node) => node.scrollHeight > node.clientHeight);
}

async function readSidebarPinnedIds(page: Page): Promise<string[]> {
  const testIds = await page
    .getByTestId("sidebar-pinned-section")
    .locator('[data-testid^="sidebar-workspace-row-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid") ?? ""));
  return testIds.map((id) => id.replace("sidebar-workspace-row-", ""));
}

async function pinInOrder(workspaces: Seeded[]): Promise<void> {
  for (const workspace of workspaces) {
    await workspace.client.setWorkspacePinned(workspace.workspaceId, true);
  }
}

async function openGrid(
  page: Page,
  serverId: string,
  workspaces: Seeded[],
  unpinned: { workspaceId: string }[] = [],
): Promise<void> {
  await gotoAppShell(page);
  // The picker offers what the sidebar lists, so the unpinned ones must have arrived too.
  for (const workspace of [...workspaces, ...unpinned]) {
    await waitForWorkspaceInSidebar(page, { serverId, workspaceId: workspace.workspaceId });
  }
  await switchWorkspaceViaSidebar({ page, serverId, workspaceId: workspaces[0].workspaceId });
  await chooseGridMode(page, "2");
  for (const workspace of workspaces) {
    await expect(cellLocator(page, serverId, workspace.workspaceId)).toBeVisible({
      timeout: 30_000,
    });
  }
  await expect(addCell(page)).toBeVisible();
}

function readSessionMessage(
  message: string | Buffer,
): { type?: unknown; requestId?: unknown } | null {
  try {
    const envelope = JSON.parse(typeof message === "string" ? message : message.toString("utf8"));
    if (envelope?.type !== "session" || typeof envelope.message !== "object") return null;
    return envelope.message as { type?: unknown; requestId?: unknown };
  } catch {
    return null;
  }
}

// Proxies everything to the real daemon and answers the first pin request with an error.
async function rejectFirstPinRequest(page: Page): Promise<void> {
  let rejected = false;
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const parsed = readSessionMessage(message);
      if (
        !rejected &&
        parsed?.type === "workspace.pin.set.request" &&
        typeof parsed.requestId === "string"
      ) {
        rejected = true;
        ws.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "rpc_error",
              payload: {
                requestId: parsed.requestId,
                requestType: "workspace.pin.set.request",
                error: PIN_REJECTION_MESSAGE,
                code: "transport",
              },
            },
          }),
        );
        return;
      }
      try {
        server.send(message);
      } catch {
        // server socket already closed
      }
    });
    server.onMessage((message) => {
      try {
        ws.send(message);
      } catch {
        // client socket already closed
      }
    });
  });
}

test.describe("Pinned grid add cell", () => {
  test.describe.configure({ timeout: 300_000 });

  test("is the last slot, also on a new row, and hides while a cell is maximized", async ({
    page,
  }) => {
    const serverId = getServerId();
    const seeded: Seeded[] = [];
    try {
      for (const prefix of ["grid-add-a-", "grid-add-b-", "grid-add-c-", "grid-add-d-"]) {
        seeded.push(await seedWorkspace({ repoPrefix: prefix }));
      }
      await page.setViewportSize({ width: 1500, height: 1000 });
      await pinInOrder(seeded.slice(0, 1));
      await openGrid(page, serverId, seeded.slice(0, 1));

      await test.step("1 pin: the tile sits right of the cell", async () => {
        const cell = await box(cellLocator(page, serverId, seeded[0].workspaceId));
        const tile = await box(addCell(page));
        expect(tile.x).toBeGreaterThan(cell.x + cell.width - 1);
        expect(Math.abs(tile.y - cell.y)).toBeLessThan(2);
      });

      await test.step("3 pins: the tile is row 2, column 2", async () => {
        await pinInOrder(seeded.slice(1, 3));
        for (const workspace of seeded.slice(1, 3)) {
          await expect(cellLocator(page, serverId, workspace.workspaceId)).toBeVisible({
            timeout: 30_000,
          });
        }
        const order = await readCellOrder(page, serverId, seeded.slice(0, 3));
        const first = await box(cellLocator(page, serverId, order[0].workspaceId));
        const third = await box(cellLocator(page, serverId, order[2].workspaceId));
        const tile = await box(addCell(page));
        expect(Math.abs(tile.y - third.y)).toBeLessThan(2);
        expect(tile.x).toBeGreaterThan(first.x + first.width - 1);
      });

      await test.step("4 pins: the tile starts row 3", async () => {
        await pinInOrder(seeded.slice(3, 4));
        await expect(cellLocator(page, serverId, seeded[3].workspaceId)).toBeVisible({
          timeout: 30_000,
        });
        const order = await readCellOrder(page, serverId, seeded);
        const first = await box(cellLocator(page, serverId, order[0].workspaceId));
        const third = await box(cellLocator(page, serverId, order[2].workspaceId));
        const tile = await box(addCell(page));
        expect(Math.abs(tile.x - first.x)).toBeLessThan(2);
        expect(tile.y).toBeGreaterThan(third.y + third.height - 1);
      });

      await test.step("maximize hides the tile and restore brings it back", async () => {
        const cell = cellLocator(page, serverId, seeded[0].workspaceId);
        await cell.getByTestId("workspace-grid-cell-maximize").click();
        await expect(addCell(page)).toHaveCount(0);
        await page.keyboard.press("ControlOrMeta+Shift+Enter");
        await expect(addCell(page)).toBeVisible();
      });
    } finally {
      for (const workspace of seeded) await workspace.cleanup();
    }
  });

  test("opens from the keyboard and lists unpinned workspaces by project", async ({ page }) => {
    const serverId = getServerId();
    const running = await seedMockAgentWorkspace({
      repoPrefix: "grid-add-run-",
      title: "Grid add running",
      model: "one-minute-stream",
      initialPrompt: "stream for a while",
    });
    const second = await seedWorkspace({ repoPrefix: "grid-add-pinned-" });
    const freeA = await seedWorkspace({ repoPrefix: "grid-add-free-a-" });
    const freeB = await seedWorkspace({ repoPrefix: "grid-add-free-b-" });
    const pinned = [running, second];
    await page.setViewportSize({ width: 1500, height: 1000 });
    const requests = await recordAgentRequests(page);
    try {
      await pinInOrder(pinned);
      await openGrid(page, serverId, pinned, [freeA, freeB]);

      await addCell(page).focus();
      await page.keyboard.press("Enter");
      const search = page.getByRole("textbox").last();
      await expect(addOption(page, serverId, freeA.workspaceId)).toBeVisible();
      await expect(addOption(page, serverId, freeB.workspaceId)).toBeVisible();
      for (const workspace of pinned) {
        await expect(addOption(page, serverId, workspace.workspaceId)).toHaveCount(0);
      }
      // Each project name labels its group.
      await expect(page.getByText(freeA.projectDisplayName, { exact: true }).last()).toBeVisible();
      await expect(page.getByText(freeB.projectDisplayName, { exact: true }).last()).toBeVisible();

      await search.fill(freeB.projectDisplayName);
      await expect(addOption(page, serverId, freeB.workspaceId)).toBeVisible();
      await expect(addOption(page, serverId, freeA.workspaceId)).toHaveCount(0);
      await search.fill("");
      await expect(addOption(page, serverId, freeA.workspaceId)).toBeVisible();

      // The cell's agent is running: Escape in the picker closes it and does not interrupt.
      await page.keyboard.press("Escape");
      await expect(addOption(page, serverId, freeA.workspaceId)).toHaveCount(0);
      expect(requests.cancelRequests(running.agentId)).toBe(0);
    } finally {
      await freeB.cleanup();
      await freeA.cleanup();
      await second.cleanup();
      await running.cleanup();
    }
  });

  test("a pick lands last, is focused and scrolled into view, and the sidebar lists it last", async ({
    page,
  }) => {
    const serverId = getServerId();
    const pinned = [
      await seedWorkspace({ repoPrefix: "grid-pick-a-" }),
      await seedWorkspace({ repoPrefix: "grid-pick-b-" }),
      await seedWorkspace({ repoPrefix: "grid-pick-c-" }),
    ];
    const freeA = await seedWorkspace({ repoPrefix: "grid-pick-free-a-" });
    const freeB = await seedWorkspace({ repoPrefix: "grid-pick-free-b-" });
    await page.setViewportSize({ width: 1500, height: 900 });
    try {
      await pinInOrder(pinned);
      await openGrid(page, serverId, pinned, [freeA, freeB]);

      await addCell(page).click();
      const options = page.locator('[data-testid^="pinned-grid-add-option-"]');
      await expect(options.first()).toBeVisible();
      const optionIds = await readTestIds(options);
      // Arrow down crosses from the first project group into the second.
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      const pickedKey = optionIds[1].replace("pinned-grid-add-option-", "");
      const picked = [freeA, freeB].find(
        (workspace) => `${serverId}:${workspace.workspaceId}` === pickedKey,
      );
      if (!picked) throw new Error(`picked option ${pickedKey} is not a seeded workspace`);

      const pickedCell = cellLocator(page, serverId, picked.workspaceId);
      await expect(pickedCell).toBeVisible({ timeout: 30_000 });
      await expect(pickedCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(1);
      await expectAppRoute(page, buildHostWorkspaceRoute(serverId, picked.workspaceId));

      const order = await readCellOrder(page, serverId, [...pinned, picked]);
      expect(order.at(-1)?.workspaceId).toBe(picked.workspaceId);
      await expect.poll(async () => (await readSidebarPinnedIds(page)).at(-1)).toBe(pickedKey);

      await expect
        .poll(async () => {
          const deck = await box(page.getByTestId("workspace-deck"));
          const cellBox = await box(pickedCell);
          return cellBox.y >= deck.y - 1 && cellBox.y + cellBox.height <= deck.y + deck.height + 1;
        })
        .toBe(true);
    } finally {
      await freeB.cleanup();
      await freeA.cleanup();
      for (const workspace of pinned) await workspace.cleanup();
    }
  });

  test("the open picker closes when the grid scrolls instead of staying behind its tile", async ({
    page,
  }) => {
    const serverId = getServerId();
    const pinned: Seeded[] = [];
    const free = await seedWorkspace({ repoPrefix: "grid-follow-free-" });
    // Tall while the sidebar lists every workspace, short once the grid has to scroll.
    await page.setViewportSize({ width: 1500, height: 1100 });
    try {
      for (let index = 0; index < 5; index += 1) {
        pinned.push(await seedWorkspace({ repoPrefix: `grid-follow-${index}-` }));
      }
      await pinInOrder(pinned);
      await openGrid(page, serverId, pinned, [free]);
      await page.setViewportSize({ width: 1500, height: 700 });
      const deck = page.getByTestId("workspace-deck");
      const tile = addCell(page);
      await expect.poll(() => isScrollable(deck)).toBe(true);

      // Bring the tile into view first, so the scroll events of that move are over before it opens.
      await tile.scrollIntoViewIfNeeded();
      const settled = { y: Number.NaN };
      await expect
        .poll(async () => {
          const y = (await box(tile)).y;
          const stable = y === settled.y;
          settled.y = y;
          return stable;
        })
        .toBe(true);
      await tile.click();
      const option = addOption(page, serverId, free.workspaceId);
      await expect(option).toBeVisible();

      // The grid sits at its end after the tile came into view; scrolling away closes the picker.
      // (Closing returns DOM focus to the tile, which scrolls it back into view.)
      await deck.evaluate((node) => {
        node.scrollTop = 0;
      });
      await expect(option).toHaveCount(0);
    } finally {
      await free.cleanup();
      for (const workspace of pinned) await workspace.cleanup();
    }
  });

  test("a rejected pick shows an error and never moves focus later", async ({ page }) => {
    const serverId = getServerId();
    const pinned = [
      await seedWorkspace({ repoPrefix: "grid-fail-a-" }),
      await seedWorkspace({ repoPrefix: "grid-fail-b-" }),
    ];
    const free = await seedWorkspace({ repoPrefix: "grid-fail-free-" });
    await page.setViewportSize({ width: 1500, height: 900 });
    try {
      await pinInOrder(pinned);
      await rejectFirstPinRequest(page);
      await openGrid(page, serverId, pinned, [free]);
      const focusedCell = cellLocator(page, serverId, pinned[0].workspaceId);
      await expect(focusedCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(1);

      await addCell(page).click();
      await addOption(page, serverId, free.workspaceId).click();

      await expect(page.getByTestId("app-toast-message")).toContainText(PIN_REJECTION_MESSAGE, {
        timeout: 10_000,
      });
      await expect(focusedCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(1);
      await expect(cellLocator(page, serverId, free.workspaceId)).toHaveCount(0);

      // The pending request lives 10 s; the clock is polled, not slept.
      const startedAt = Date.now();
      await expect
        .poll(() => Date.now() - startedAt, { timeout: 30_000, intervals: [250] })
        .toBeGreaterThan(PENDING_FOCUS_WINDOW_MS);
      await expect(focusedCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(1);
      await expectAppRoute(page, buildHostWorkspaceRoute(serverId, pinned[0].workspaceId));
    } finally {
      await free.cleanup();
      for (const workspace of pinned) await workspace.cleanup();
    }
  });
});
