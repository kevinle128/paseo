import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  type MockAgentWorkspace,
} from "../support/helpers/mock-agent";
import { gotoAppShell } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import { seedWorkspace } from "../support/helpers/seed-client";
import {
  switchWorkspaceViaSidebar,
  waitForWorkspaceInSidebar,
} from "../support/helpers/workspace-ui";

const SUBSCRIPTION_REQUEST = "agent.timeline.set_subscription.request";

function sessionMessage(message: string | Buffer): Record<string, unknown> | null {
  try {
    const envelope = JSON.parse(typeof message === "string" ? message : message.toString("utf8"));
    if (envelope?.type !== "session" || typeof envelope.message !== "object") return null;
    return envelope.message as Record<string, unknown>;
  } catch {
    return null;
  }
}

// The newest timeline subscription is the set of chats the daemon streams to this client.
async function recordTimelineSubscriptions(page: Page): Promise<{ latest(): string[] | null }> {
  const requests: string[][] = [];
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const parsed = sessionMessage(message);
      if (parsed?.type === SUBSCRIPTION_REQUEST && Array.isArray(parsed.agentIds)) {
        requests.push(parsed.agentIds.filter((id): id is string => typeof id === "string"));
      }
      server.send(message);
    });
    server.onMessage((message) => ws.send(message));
  });
  return { latest: () => requests.at(-1) ?? null };
}

async function chooseGridMode(page: Page, mode: "2" | "3"): Promise<void> {
  await page.locator(`[data-testid="sidebar-pinned-grid-mode-${mode}"]:visible`).first().click();
}

function cellTestId(serverId: string, workspaceId: string): string {
  return `pinned-grid-cell-${serverId}:${workspaceId}`;
}

async function isCellShown(page: Page, serverId: string, workspaceId: string): Promise<boolean> {
  return page.getByTestId(cellTestId(serverId, workspaceId)).isVisible();
}

async function readShownFlags(
  page: Page,
  serverId: string,
  agents: readonly MockAgentWorkspace[],
): Promise<boolean[]> {
  return Promise.all(agents.map((agent) => isCellShown(page, serverId, agent.workspaceId)));
}

function isSubscribed(latest: string[] | null, agent: MockAgentWorkspace): boolean {
  return latest?.includes(agent.agentId) ?? false;
}

function anySubscribed(latest: string[] | null, agents: readonly MockAgentWorkspace[]): boolean {
  return agents.some((agent) => isSubscribed(latest, agent));
}

function allSubscribed(latest: string[] | null, agents: readonly MockAgentWorkspace[]): boolean {
  return agents.every((agent) => isSubscribed(latest, agent));
}

async function readTestIds(locator: Locator): Promise<string[]> {
  return locator.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-testid") ?? ""),
  );
}

async function scrollDeckToEnd(page: Page): Promise<void> {
  await page.getByTestId("workspace-deck").evaluate((deck) => {
    deck.scrollTop = deck.scrollHeight;
  });
}

test.describe("Pinned grid fidelity tiers", () => {
  test.describe.configure({ timeout: 300_000 });

  test("a hidden cell leaves the timeline subscription and returns when it scrolls into view", async ({
    page,
  }) => {
    const serverId = getServerId();
    await page.setViewportSize({ width: 1280, height: 700 });
    const subscriptions = await recordTimelineSubscriptions(page);
    const agents: MockAgentWorkspace[] = [];

    try {
      for (let index = 0; index < 7; index += 1) {
        agents.push(
          await seedMockAgentWorkspace({
            repoPrefix: `grid-fidelity-${index}-`,
            title: `Grid fidelity ${index}`,
          }),
        );
      }
      for (const agent of agents) {
        await agent.client.setWorkspacePinned(agent.workspaceId, true);
      }
      // Each route load adds the chat tab to its workspace layout. A route load restarts the
      // session, so the chats are then shown once in this session; showing a chat subscribes it.
      for (const agent of agents) {
        await openAgentRoute(page, agent);
      }
      for (const agent of agents) {
        await waitForWorkspaceInSidebar(page, { serverId, workspaceId: agent.workspaceId });
        await switchWorkspaceViaSidebar({ page, serverId, workspaceId: agent.workspaceId });
      }
      await expect
        .poll(() => subscriptions.latest()?.length ?? 0, { timeout: 30_000 })
        .toBe(agents.length);

      // Pins that exist when the app loads list newest first, and the grid keeps the focused cell in
      // view: focusing the newest pin keeps the grid at its top, so the cells at the end sit far
      // below the viewport.
      const newest = agents[agents.length - 1];
      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: newest.workspaceId });
      await chooseGridMode(page, "2");
      await expect(page.getByTestId(cellTestId(serverId, newest.workspaceId))).toBeVisible({
        timeout: 30_000,
      });

      // Cells far from the viewport are hidden: they draw nothing and hold no subscription.
      await expect
        .poll(async () => (await readShownFlags(page, serverId, agents)).includes(false), {
          timeout: 15_000,
        })
        .toBe(true);
      const shownFlags = await readShownFlags(page, serverId, agents);
      const hiddenAgents = agents.filter((_, index) => !shownFlags[index]);
      const shownAgents = agents.filter((_, index) => shownFlags[index]);
      await expect
        .poll(() => anySubscribed(subscriptions.latest(), hiddenAgents), {
          timeout: 15_000,
        })
        .toBe(false);
      for (const agent of shownAgents) {
        expect(isSubscribed(subscriptions.latest(), agent)).toBe(true);
      }

      // Scrolling to the end brings the hidden cells in view and the subscription returns.
      await scrollDeckToEnd(page);
      for (const agent of hiddenAgents) {
        await expect(page.getByTestId(cellTestId(serverId, agent.workspaceId))).toBeVisible({
          timeout: 15_000,
        });
      }
      await expect
        .poll(() => allSubscribed(subscriptions.latest(), hiddenAgents), {
          timeout: 15_000,
        })
        .toBe(true);
    } finally {
      for (const agent of agents.toReversed()) {
        await agent.cleanup();
      }
    }
  });

  test("cells beyond the cap show a summary card until they scroll into view", async ({ page }) => {
    const serverId = getServerId();
    await page.setViewportSize({ width: 1280, height: 700 });
    const workspaces: Awaited<ReturnType<typeof seedWorkspace>>[] = [];

    try {
      for (let index = 0; index < 14; index += 1) {
        workspaces.push(await seedWorkspace({ repoPrefix: `grid-cap-${index}-` }));
      }
      for (const workspace of workspaces) {
        await workspace.client.setWorkspacePinned(workspace.workspaceId, true);
      }
      await gotoAppShell(page);
      for (const workspace of workspaces) {
        await waitForWorkspaceInSidebar(page, { serverId, workspaceId: workspace.workspaceId });
      }
      const newest = workspaces[workspaces.length - 1];
      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: newest.workspaceId });
      await chooseGridMode(page, "3");
      await expect(page.getByTestId(cellTestId(serverId, newest.workspaceId))).toBeVisible({
        timeout: 30_000,
      });

      // 14 pinned cells, a cap of 12 mounted: the two farthest hidden cells are cards.
      const cards = page.locator('[data-testid^="pinned-grid-dormant-"]');
      await expect(cards).toHaveCount(2, { timeout: 30_000 });
      const entries = page.locator('[data-testid^="workspace-deck-entry-"]');
      await expect(entries).toHaveCount(12);

      // A card shows only for a cell that is off screen. Scrolling to it mounts the cell (on-screen
      // cells are never evicted), and the cap then moves to the cells that left the screen.
      const cardIds = await readTestIds(cards);
      // The newest pin is focused, which is the first cell, so the grid starts at its top and the
      // cards are at the end.
      await scrollDeckToEnd(page);
      for (const cardId of cardIds) {
        const target = cardId.replace("pinned-grid-dormant-", "");
        await expect(page.getByTestId(`workspace-deck-entry-${target}`)).toHaveCount(1, {
          timeout: 15_000,
        });
        await expect(page.getByTestId(`pinned-grid-cell-${target}`)).toBeVisible({
          timeout: 15_000,
        });
      }
      await expect(cards).toHaveCount(2, { timeout: 15_000 });
      await expect(entries).toHaveCount(12, { timeout: 15_000 });
    } finally {
      for (const workspace of workspaces.toReversed()) {
        await workspace.cleanup();
      }
    }
  });
});
