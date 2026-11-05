import { expect, test, type Page } from "../support/fixtures";
import {
  openAgentRoute,
  seedMockAgentWorkspace,
  type MockAgentWorkspace,
} from "../support/helpers/mock-agent";
import { getServerId } from "../support/helpers/server-id";
import {
  switchWorkspaceViaSidebar,
  waitForWorkspaceInSidebar,
} from "../support/helpers/workspace-ui";

// Local measurement, not a regression gate: it samples frame intervals while a grid of pinned
// workspaces streams. Run with PASEO_GRID_FIDELITY_PERF_E2E=1.
const RUN = process.env.PASEO_GRID_FIDELITY_PERF_E2E === "1";
const CELL_COUNT = Number(process.env.PASEO_GRID_FIDELITY_CELLS ?? 12);
const SAMPLE_MS = 10_000;

interface FrameStats {
  frames: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  over33: number;
}

async function sampleFrames(page: Page, durationMs: number): Promise<FrameStats> {
  return page.evaluate(
    (duration) =>
      new Promise<FrameStats>((resolve) => {
        const intervals: number[] = [];
        let last = performance.now();
        const start = last;
        const tick = (now: number) => {
          intervals.push(now - last);
          last = now;
          if (now - start < duration) {
            requestAnimationFrame(tick);
            return;
          }
          const sorted = [...intervals].sort((a, b) => a - b);
          const at = (q: number) =>
            sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
          resolve({
            frames: sorted.length,
            p50: at(0.5),
            p95: at(0.95),
            p99: at(0.99),
            max: sorted[sorted.length - 1],
            over33: sorted.filter((value) => value > 33.4).length,
          });
        };
        requestAnimationFrame(tick);
      }),
    durationMs,
  );
}

test.describe("Pinned grid streaming measurement", () => {
  test.skip(!RUN, "set PASEO_GRID_FIDELITY_PERF_E2E=1 to run");
  test.describe.configure({ timeout: 600_000 });

  test("frame intervals while every cell streams", async ({ page }) => {
    const serverId = getServerId();
    await page.setViewportSize({ width: 1920, height: 1200 });
    const agents: MockAgentWorkspace[] = [];
    try {
      for (let index = 0; index < CELL_COUNT; index += 1) {
        agents.push(
          await seedMockAgentWorkspace({
            repoPrefix: `grid-measure-${index}-`,
            title: `Grid measure ${index}`,
            model: "bursty-stream",
          }),
        );
      }
      for (const agent of agents) {
        await agent.client.setWorkspacePinned(agent.workspaceId, true);
      }
      for (const agent of agents) {
        await openAgentRoute(page, agent);
      }
      for (const agent of agents) {
        await waitForWorkspaceInSidebar(page, { serverId, workspaceId: agent.workspaceId });
        await switchWorkspaceViaSidebar({ page, serverId, workspaceId: agent.workspaceId });
      }
      await page.locator('[data-testid="sidebar-pinned-grid-mode-3"]:visible').first().click();
      await expect(
        page.getByTestId(`pinned-grid-cell-${serverId}:${agents[0].workspaceId}`),
      ).toBeVisible({ timeout: 30_000 });

      const idle = await sampleFrames(page, 3_000);
      // Start every stream at once, then sample while they run.
      await Promise.all(
        agents.map((agent) => agent.client.sendAgentMessage(agent.agentId, "stream a long answer")),
      );
      await page.waitForTimeout(2_000);
      const streaming = await sampleFrames(page, SAMPLE_MS);
      console.log(
        `GRID_MEASURE cells=${CELL_COUNT} idle=${JSON.stringify(idle)} streaming=${JSON.stringify(streaming)}`,
      );
    } finally {
      for (const agent of agents.toReversed()) {
        await agent.cleanup();
      }
    }
  });
});
