import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import { runWorkspaceActionFromCommandCenter } from "../support/helpers/command-center-workspace-actions";
import { gotoAppShell } from "../support/helpers/app";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  type MockAgentWorkspace,
} from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  switchWorkspaceViaSidebar,
  waitForWorkspaceInSidebar,
} from "../support/helpers/workspace-ui";

/**
 * Captures PNG screenshots of the pinned grid for pull request evidence. Skipped unless
 * PASEO_PINNED_GRID_QA_SCREENSHOTS=1. PASEO_PINNED_GRID_QA_DIR names the output directory.
 * It records what the grid looks like; it asserts only what it needs to reach each state.
 */
const RUN = process.env.PASEO_PINNED_GRID_QA_SCREENSHOTS === "1";
const OUTPUT_DIR = process.env.PASEO_PINNED_GRID_QA_DIR ?? "";

// Cells must be wide enough to keep the mode control in the composer toolbar.
const WIDE_VIEWPORT = { width: 2200, height: 1000 };
const NARROW_VIEWPORT = { width: 1280, height: 700 };
const SIDEBAR_CLIP = { x: 0, y: 0, width: 420, height: 640 };

test.use({ video: "off", trace: "off" });

function cellLocator(page: Page, serverId: string, workspaceId: string): Locator {
  return page.getByTestId(`pinned-grid-cell-${serverId}:${workspaceId}`);
}

async function chooseGridMode(page: Page, mode: "normal" | "2" | "3"): Promise<void> {
  await page.locator(`[data-testid="sidebar-pinned-grid-mode-${mode}"]:visible`).first().click();
}

async function capture(page: Page, name: string, target?: Locator): Promise<void> {
  // Lets focus rings, transitions and tooltips settle before the picture.
  await page.waitForTimeout(600);
  const filePath = path.join(OUTPUT_DIR, name);
  if (target) {
    await target.screenshot({ path: filePath });
  } else {
    await page.screenshot({ path: filePath });
  }
}

test.describe("Pinned grid screenshots", () => {
  test.skip(!RUN, "set PASEO_PINNED_GRID_QA_SCREENSHOTS=1 to run");
  test.describe.configure({ timeout: 300_000 });

  test.beforeAll(async () => {
    expect(OUTPUT_DIR, "PASEO_PINNED_GRID_QA_DIR").not.toBe("");
    await mkdir(OUTPUT_DIR, { recursive: true });
  });

  test("normal mode, grids, focus, maximize, split, composer and sidebar", async ({ page }) => {
    const serverId = getServerId();
    await page.setViewportSize(WIDE_VIEWPORT);
    const agents: MockAgentWorkspace[] = [];

    try {
      for (const title of ["Alpha", "Bravo", "Charlie", "Delta"]) {
        agents.push(
          await seedMockAgentWorkspace({
            repoPrefix: `grid-shot-${title.toLowerCase()}-`,
            title: `Grid ${title}`,
            initialPrompt: `Say hello from ${title}`,
          }),
        );
      }
      for (const agent of agents) {
        await agent.client.setWorkspacePinned(agent.workspaceId, true);
      }
      await openAgentRoute(page, agents[0]);
      for (const agent of agents) {
        await waitForWorkspaceInSidebar(page, { serverId, workspaceId: agent.workspaceId });
      }
      await expect(page.getByRole("textbox", { name: "Message agent..." }).first()).toBeVisible({
        timeout: 30_000,
      });
      await capture(page, "01-normal-workspace.png");

      await chooseGridMode(page, "2");
      for (const agent of agents) {
        await expect(cellLocator(page, serverId, agent.workspaceId)).toBeVisible({
          timeout: 30_000,
        });
      }
      await capture(page, "02-grid-2-columns.png");
      await page.waitForTimeout(600);
      await page.screenshot({
        path: path.join(OUTPUT_DIR, "09-sidebar-mode-control-and-pinned-badge.png"),
        clip: SIDEBAR_CLIP,
      });

      // Focus moves to the second cell; the other cells dim.
      const focusedCell = cellLocator(page, serverId, agents[1].workspaceId);
      const idleCell = cellLocator(page, serverId, agents[2].workspaceId);
      await focusedCell.click({ position: { x: 24, y: 24 } });
      await expect(focusedCell.getByTestId("pinned-grid-focus-ring")).toHaveCount(1);
      await capture(page, "04-focused-cell-highlight.png");

      // Both cells show the collapsed composer; a press on the inline placeholder of the focused
      // cell expands it.
      await capture(page, "06a-composer-minimal-unfocused-cell.png", idleCell);
      await capture(page, "06c-composer-minimal-focused-cell.png", focusedCell);
      await focusedCell.getByTestId("composer-inline-placeholder").click();
      await capture(page, "06b-composer-expanded-focused-cell.png", focusedCell);

      await focusedCell.getByTestId("workspace-grid-cell-maximize").click();
      await expect(focusedCell.getByTestId("workspace-grid-cell-maximize")).toHaveAttribute(
        "aria-label",
        "Restore cell",
      );
      await capture(page, "05-maximized-cell.png");
      await focusedCell.getByTestId("workspace-grid-cell-maximize").click();
      await expect(idleCell).toBeVisible();

      await runWorkspaceActionFromCommandCenter(page, "Split pane right");
      await expect(focusedCell.getByTestId("workspace-new-tab-panel").first()).toBeVisible({
        timeout: 30_000,
      });
      await capture(page, "07-split-inside-a-cell.png");

      await chooseGridMode(page, "3");
      await expect(cellLocator(page, serverId, agents[3].workspaceId)).toBeVisible();
      await capture(page, "03-grid-3-columns.png");
    } finally {
      for (const agent of agents.toReversed()) {
        await agent.cleanup();
      }
    }
  });

  test("add cell, picker and header drag", async ({ page }) => {
    const serverId = getServerId();
    await page.setViewportSize(WIDE_VIEWPORT);
    const pinned: MockAgentWorkspace[] = [];
    const free: MockAgentWorkspace[] = [];

    try {
      for (const title of ["Alpha", "Bravo", "Charlie", "Delta"]) {
        pinned.push(
          await seedMockAgentWorkspace({
            repoPrefix: `grid-shot-${title.toLowerCase()}-`,
            title: `Grid ${title}`,
            initialPrompt: `Say hello from ${title}`,
          }),
        );
      }
      for (const title of ["Echo", "Foxtrot"]) {
        free.push(
          await seedMockAgentWorkspace({
            repoPrefix: `grid-shot-${title.toLowerCase()}-`,
            title: `Grid ${title}`,
            initialPrompt: `Say hello from ${title}`,
          }),
        );
      }
      await gotoAppShell(page);
      for (const agent of [...pinned, ...free]) {
        await waitForWorkspaceInSidebar(page, { serverId, workspaceId: agent.workspaceId });
      }
      // Pinning after the app loaded keeps the cells in pin order.
      for (const agent of pinned) {
        await agent.client.setWorkspacePinned(agent.workspaceId, true);
      }
      await switchWorkspaceViaSidebar({
        page,
        serverId,
        workspaceId: pinned[0].workspaceId,
      });
      await chooseGridMode(page, "2");
      for (const agent of pinned) {
        await expect(cellLocator(page, serverId, agent.workspaceId)).toBeVisible({
          timeout: 30_000,
        });
      }

      // Four pins in two columns put the "+" tile alone on a new row.
      const addCell = page.getByTestId("pinned-grid-add-cell");
      await addCell.scrollIntoViewIfNeeded();
      await expect(addCell).toBeVisible();
      await capture(page, "11-add-cell-on-new-row.png");

      await addCell.click();
      await expect(
        page.getByTestId(`pinned-grid-add-option-${serverId}:${free[0].workspaceId}`),
      ).toBeVisible({ timeout: 30_000 });
      await capture(page, "12-add-pin-picker-open.png");
      await page.keyboard.press("Escape");

      // Drag the first cell by its title toward the last cell and keep the button down.
      const deck = page.getByTestId("workspace-deck");
      await deck.evaluate((node) => {
        node.scrollTop = 0;
      });
      const source = cellLocator(page, serverId, pinned[0].workspaceId);
      const target = cellLocator(page, serverId, pinned[3].workspaceId);
      const title = await source.getByTestId("workspace-header-title").boundingBox();
      const targetBox = await target.boundingBox();
      if (!title || !targetBox) {
        throw new Error("Cell header or target cell is not laid out");
      }
      await page.mouse.move(title.x + title.width / 2, title.y + title.height / 2);
      await page.mouse.down();
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 80, { steps: 12 });
      await expect(page.getByTestId("pinned-grid-drop-indicator")).toBeVisible();
      await capture(page, "13-drag-in-progress-drop-outline.png");
      await page.keyboard.press("Escape");
      await page.mouse.up();
    } finally {
      for (const agent of [...free, ...pinned].toReversed()) {
        await agent.cleanup();
      }
    }
  });

  test("cells beyond the mount cap show a summary card", async ({ page }) => {
    const serverId = getServerId();
    await page.setViewportSize(NARROW_VIEWPORT);
    const workspaces: Awaited<ReturnType<typeof seedWorkspace>>[] = [];

    try {
      for (let index = 0; index < 14; index += 1) {
        workspaces.push(await seedWorkspace({ repoPrefix: `grid-shot-cap-${index}-` }));
      }
      for (const workspace of workspaces) {
        await workspace.client.setWorkspacePinned(workspace.workspaceId, true);
      }
      await gotoAppShell(page);
      for (const workspace of workspaces) {
        await waitForWorkspaceInSidebar(page, { serverId, workspaceId: workspace.workspaceId });
      }
      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: workspaces[0].workspaceId });
      await chooseGridMode(page, "3");

      const cards = page.locator('[data-testid^="pinned-grid-dormant-"]');
      await expect(cards).toHaveCount(2, { timeout: 30_000 });

      // The grid starts at its bottom and the cards sit at the top. Scrolling there mounts their
      // cells on the next animation frame, so the frame callback is held while the picture is taken.
      await page.evaluate(() => {
        const original = window.requestAnimationFrame.bind(window);
        (window as unknown as { __restoreRaf: () => void }).__restoreRaf = () => {
          window.requestAnimationFrame = original;
        };
        window.requestAnimationFrame = () => 0;
      });
      await page.getByTestId("workspace-deck").evaluate((deck) => {
        deck.scrollTop = 0;
      });
      await expect(cards.first()).toBeInViewport();
      await capture(page, "10-dormant-card-narrow-viewport.png");
      await page.evaluate(() => {
        (window as unknown as { __restoreRaf: () => void }).__restoreRaf();
      });
    } finally {
      for (const workspace of workspaces.toReversed()) {
        await workspace.cleanup();
      }
    }
  });
});
