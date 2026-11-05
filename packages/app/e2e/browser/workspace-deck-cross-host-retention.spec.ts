import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { addConnectedHostAndReload, waitForConnectedHost } from "../support/helpers/hosts";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import {
  switchWorkspaceViaSidebar,
  waitForWorkspaceInSidebar,
  workspaceDeckEntryLocator,
} from "../support/helpers/workspace-ui";

const DECK_ENTRY_SELECTOR = '[data-testid^="workspace-deck-entry-"]';
const DECK_MARK_PROPERTY = "__deckMark";

interface DeckEntryReading {
  testId: string;
  mark: string | null;
}

// Tags every mounted deck entry node with a property that only survives while the same DOM node
// stays mounted. A remounted entry renders a fresh node without the property.
async function markDeckEntries(page: Page, markPrefix: string): Promise<void> {
  await page.evaluate(
    ({ selector, property, prefix }) => {
      document.querySelectorAll(selector).forEach((node, index) => {
        const testId = node.getAttribute("data-testid") ?? "";
        (node as unknown as Record<string, string>)[property] = `${prefix}:${testId}:${index}`;
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

function entriesFor(readings: DeckEntryReading[], serverId: string, workspaceId: string) {
  const testId = `workspace-deck-entry-${serverId}:${workspaceId}`;
  return readings.filter((reading) => reading.testId === testId);
}

test.describe("Workspace deck retention across workspace switches", () => {
  test.describe.configure({ timeout: 240_000 });

  test("keeps the deck entry mounted when switching between workspaces of the same host", async ({
    page,
  }) => {
    const serverId = getServerId();
    const first = await seedWorkspace({ repoPrefix: "deck-same-host-a-" });
    const second = await seedWorkspace({ repoPrefix: "deck-same-host-b-" });

    try {
      await gotoAppShell(page);
      await waitForWorkspaceInSidebar(page, { serverId, workspaceId: first.workspaceId });
      await waitForWorkspaceInSidebar(page, { serverId, workspaceId: second.workspaceId });

      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: first.workspaceId });
      await expect(workspaceDeckEntryLocator(page, serverId, first.workspaceId)).toHaveCount(1);
      await markDeckEntries(page, "initial");

      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: second.workspaceId });
      await expect(workspaceDeckEntryLocator(page, serverId, second.workspaceId)).toHaveCount(1);
      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: first.workspaceId });
      await expect(workspaceDeckEntryLocator(page, serverId, first.workspaceId)).toHaveCount(1);

      const firstEntries = entriesFor(await readDeckEntries(page), serverId, first.workspaceId);
      expect(firstEntries).toHaveLength(1);
      expect(firstEntries[0]?.mark).toMatch(/^initial:/);
    } finally {
      await second.cleanup();
      await first.cleanup();
    }
  });

  test("keeps the deck entry mounted when switching to a workspace of another host and back", async ({
    page,
  }) => {
    const primaryServerId = getServerId();
    const secondaryHost = await startIsolatedHostDaemon("deck-retention-secondary-host");
    const primaryWorkspace = await seedWorkspace({ repoPrefix: "deck-cross-host-a-" });
    const secondaryWorkspace = await seedWorkspace({
      repoPrefix: "deck-cross-host-b-",
      port: secondaryHost.port,
    });

    try {
      await gotoAppShell(page);
      await addConnectedHostAndReload(page, {
        serverId: secondaryHost.serverId,
        label: "Deck secondary host",
        port: secondaryHost.port,
      });
      await waitForConnectedHost(page, {
        serverId: secondaryHost.serverId,
        endpoint: `localhost:${secondaryHost.port}`,
      });
      await waitForWorkspaceInSidebar(page, {
        serverId: primaryServerId,
        workspaceId: primaryWorkspace.workspaceId,
      });
      await waitForWorkspaceInSidebar(page, {
        serverId: secondaryHost.serverId,
        workspaceId: secondaryWorkspace.workspaceId,
      });

      await switchWorkspaceViaSidebar({
        page,
        serverId: primaryServerId,
        workspaceId: primaryWorkspace.workspaceId,
      });
      await expect(
        workspaceDeckEntryLocator(page, primaryServerId, primaryWorkspace.workspaceId),
      ).toHaveCount(1);
      await markDeckEntries(page, "initial");

      await switchWorkspaceViaSidebar({
        page,
        serverId: secondaryHost.serverId,
        workspaceId: secondaryWorkspace.workspaceId,
      });
      await expect(
        workspaceDeckEntryLocator(page, secondaryHost.serverId, secondaryWorkspace.workspaceId),
      ).not.toHaveCount(0);

      await switchWorkspaceViaSidebar({
        page,
        serverId: primaryServerId,
        workspaceId: primaryWorkspace.workspaceId,
      });
      await expect(
        workspaceDeckEntryLocator(page, primaryServerId, primaryWorkspace.workspaceId),
      ).not.toHaveCount(0);

      const readings = await readDeckEntries(page);
      const primaryEntries = entriesFor(readings, primaryServerId, primaryWorkspace.workspaceId);
      // Observed state is part of the failure message so a remount or a duplicate deck is visible.
      const observed = JSON.stringify(readings);
      expect(primaryEntries, `deck entries after round trip: ${observed}`).toHaveLength(1);
      expect(primaryEntries[0]?.mark, `deck entries after round trip: ${observed}`).toMatch(
        /^initial:/,
      );
    } finally {
      await secondaryHost.close();
      await secondaryWorkspace.cleanup();
      await primaryWorkspace.cleanup();
    }
  });
});
