import { writeFile } from "node:fs/promises";
import type { CDPSession, Locator } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import {
  enableRenderProfile,
  observeFocusRing,
  readCellGeometry,
  readHeapUsedBytes,
  readRenderProfile,
  recordTimelineSubscriptions,
  resetRenderProfile,
  scrollDeckThereAndBack,
  startChromeTrace,
  startKeystrokeProbe,
  startProbe,
  startStalenessProbe,
  stopKeystrokeProbe,
  stopProbe,
  stopStalenessProbe,
  summarizeFrames,
  summarizeLongTasks,
  type CellGeometry,
  type ProbeResult,
  type RenderProfileRow,
} from "../support/helpers/grid-performance";
import { computePercentile } from "../support/helpers/stream-smoothness";
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

/**
 * Load test for the pinned grid: 15 pinned workspaces, 3 columns, a 2560x1440 viewport, and an
 * agent streaming in every workspace. Skipped unless PASEO_PINNED_GRID_PERF_E2E=1.
 *
 * The numbers only mean something on a quiet local machine against a production bundle (start the
 * run with E2E_METRO_BUNDLE=production); shared CI hardware and the dev bundle are far slower.
 * PASEO_PINNED_GRID_PERF_SCENARIO=<idle|typing|scroll|focus|staleness|hidden|maximize> runs one
 * scenario.
 * PASEO_PINNED_GRID_PERF_CPU_PROFILE=<path> writes a CPU profile of the idle or maximize scenario.
 * PASEO_PINNED_GRID_PERF_RENDER_PROFILE=1 reports React commits per component (dev bundle only) for
 * the idle and maximize scenarios.
 */

const RUN = process.env.PASEO_PINNED_GRID_PERF_E2E === "1";
const ONLY_SCENARIO = process.env.PASEO_PINNED_GRID_PERF_SCENARIO ?? "";
const RENDER_PROFILE = process.env.PASEO_PINNED_GRID_PERF_RENDER_PROFILE === "1";
const TRACE_PATH = process.env.PASEO_PINNED_GRID_PERF_TRACE ?? "";
const CPU_PROFILE_PATH = process.env.PASEO_PINNED_GRID_PERF_CPU_PROFILE ?? "";
const CELL_COUNT = Number(process.env.PASEO_PINNED_GRID_PERF_CELLS ?? 15);

const VIEWPORT = { width: 2560, height: 1440 };
const HIDDEN_VIEWPORT = { width: 1600, height: 700 };
const WARM_UP_MS = 10_000;
const IDLE_WINDOW_MS = Number(process.env.PASEO_PINNED_GRID_PERF_WINDOW_MS ?? 60_000);
const KEYSTROKES_PER_ROUND = 40;
const KEYSTROKE_ROUNDS = 3;
const KEYSTROKE_DELAY_MS = 100;
const FOCUS_TARGETS = 5;
const MAXIMIZE_ROUNDS = 5;
// The motion takes 240 ms; the window also covers the commit before it and the settle after it.
const MAXIMIZE_WINDOW_MS = 450;
const MAXIMIZE_REST_MS = 1_500;

const FRAME_P95_BUDGET_MS = 16.7;
const KEYSTROKE_P95_BUDGET_MS = 33;
const LONG_TASK_HARD_LIMIT_MS = 250;
const LONG_TASKS_OVER_100_PER_10S = 1;
const REDUCED_STALENESS_BUDGET_MS = 500;
const HEAP_GROWTH_BUDGET = 0.2;

const SCENARIOS = ["idle", "typing", "scroll", "focus", "staleness", "hidden", "maximize"] as const;
type Scenario = (typeof SCENARIOS)[number];

interface GridFixture {
  serverId: string;
  agents: MockAgentWorkspace[];
  subscriptions: { latest(): string[] | null };
  streams: { stop(): Promise<void> };
}

function cellTestId(serverId: string, workspaceId: string): string {
  return `pinned-grid-cell-${serverId}:${workspaceId}`;
}

function composerOf(cell: Locator): Locator {
  return cell.getByRole("textbox", { name: "Message agent..." });
}

// A collapsed cell composer covers its editor with an inline placeholder; pressing it expands the
// composer and focuses the editor.
function composerPlaceholderOf(cell: Locator): Locator {
  return cell.getByTestId("composer-inline-placeholder");
}

// Keeps one turn running in every agent for as long as the fixture lives: bursty-stream ends after
// a minute, and each loop starts the next turn as soon as the previous one ends.
function keepAgentsStreaming(agents: readonly MockAgentWorkspace[]): { stop(): Promise<void> } {
  const state = { stopped: false };
  const loops = agents.map(async (agent) => {
    while (!state.stopped) {
      try {
        await agent.client.sendAgentMessage(agent.agentId, "stream a long answer");
        await agent.client
          .waitForAgentUpsert(agent.agentId, (snapshot) => snapshot.status === "running", 15_000)
          .catch(() => undefined);
        await agent.client.waitForAgentUpsert(
          agent.agentId,
          (snapshot) => snapshot.status !== "running",
          90_000,
        );
      } catch {
        if (state.stopped) return;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  });
  return {
    async stop() {
      state.stopped = true;
      await Promise.allSettled(agents.map((agent) => agent.client.cancelAgent(agent.agentId)));
      await Promise.race([
        Promise.allSettled(loops),
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]);
    },
  };
}

async function setUpGrid(page: Page, viewport = VIEWPORT): Promise<GridFixture> {
  const serverId = getServerId();
  await page.setViewportSize(viewport);
  if (RENDER_PROFILE) await enableRenderProfile(page);
  const subscriptions = await recordTimelineSubscriptions(page);
  const agents: MockAgentWorkspace[] = [];
  try {
    for (let index = 0; index < CELL_COUNT; index += 1) {
      agents.push(
        await seedMockAgentWorkspace({
          repoPrefix: `grid-perf-${index}-`,
          title: `Grid perf ${index}`,
          model: "bursty-stream",
        }),
      );
    }
    // Pin every workspace before any agent starts, so setup never shares the stream's time.
    for (const agent of agents) {
      await agent.client.setWorkspacePinned(agent.workspaceId, true);
    }
    // Each route load adds the chat tab to its workspace layout; showing a chat subscribes it.
    for (const agent of agents) {
      await openAgentRoute(page, agent);
    }
    for (const agent of agents) {
      await waitForWorkspaceInSidebar(page, { serverId, workspaceId: agent.workspaceId });
      await switchWorkspaceViaSidebar({ page, serverId, workspaceId: agent.workspaceId });
    }
    await page.locator('[data-testid="sidebar-pinned-grid-mode-3"]:visible').first().click();
    // The last agent opened holds the focus, so its cell is the one kept in view.
    await expect(
      page.getByTestId(cellTestId(serverId, agents[agents.length - 1].workspaceId)),
    ).toBeVisible({ timeout: 30_000 });
    const streams = keepAgentsStreaming(agents);
    return { serverId, agents, subscriptions, streams };
  } catch (error) {
    for (const agent of agents.toReversed()) {
      await agent.cleanup();
    }
    throw error;
  }
}

async function tearDownGrid(fixture: GridFixture | null, agents: MockAgentWorkspace[]) {
  await fixture?.streams.stop();
  for (const agent of (fixture?.agents ?? agents).toReversed()) {
    await agent.cleanup();
  }
}

async function waitForStreaming(page: Page): Promise<void> {
  // Every cell on screen shows assistant text before any window opens.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const cells = [...document.querySelectorAll('[data-testid^="pinned-grid-cell-"]')];
          const onScreen = cells.filter((cell) => {
            const rect = cell.getBoundingClientRect();
            return rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
          });
          const withText = onScreen.filter((cell) =>
            cell.querySelector('[data-testid="assistant-message"]'),
          );
          return onScreen.length > 0 && withText.length === onScreen.length;
        }),
      { timeout: 120_000 },
    )
    .toBe(true);
  const scripts = await page.evaluate(() =>
    [...document.scripts].map((script) => script.src).filter(Boolean),
  );
  report("bundle", { scripts, userAgent: await page.evaluate(() => navigator.userAgent) });
  await page.waitForTimeout(WARM_UP_MS);
}

// Records a CPU profile of the scenario when PASEO_PINNED_GRID_PERF_CPU_PROFILE names a file. The
// frame intervals are saved next to it so slow frames can be matched to profile samples.
async function startCpuProfile(
  page: Page,
  cdp: CDPSession,
): Promise<(probe: ProbeResult) => Promise<void>> {
  if (!CPU_PROFILE_PATH) return async () => undefined;
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
  const profileStartedAt = await page.evaluate(() => performance.now());
  await cdp.send("Profiler.start");
  return async (probe) => {
    const { profile } = await cdp.send("Profiler.stop");
    await writeFile(CPU_PROFILE_PATH, JSON.stringify(profile));
    await writeFile(
      `${CPU_PROFILE_PATH}.frames.json`,
      JSON.stringify({ profileStartedAt, probeStartedAt: probe.startedAt, frames: probe.frames }),
    );
  };
}

function report(label: string, details: object): void {
  console.log(`[grid-perf] ${label} ${JSON.stringify(details)}`);
}

function expectFrameAndTaskBudgets(label: string, probe: ProbeResult) {
  const frames = summarizeFrames(probe.frames);
  const longTasks = summarizeLongTasks(probe.longTasks);
  report(`${label} frames`, { ...frames, durationMs: Math.round(probe.durationMs) });
  report(`${label} longTasks`, longTasks);
  expect.soft(frames.p95, `${label}: frame interval p95`).toBeLessThanOrEqual(FRAME_P95_BUDGET_MS);
  expect
    .soft(longTasks.maxMs, `${label}: longest long task`)
    .toBeLessThanOrEqual(LONG_TASK_HARD_LIMIT_MS);
  expect
    .soft(longTasks.worstOver100In10s, `${label}: long tasks over 100 ms in the worst 10 s`)
    .toBeLessThanOrEqual(LONG_TASKS_OVER_100_PER_10S);
  return { frames, longTasks };
}

async function describeGrid(page: Page, fixture: GridFixture) {
  const cells = await readCellGeometry(page);
  const latest = fixture.subscriptions.latest() ?? [];
  const cellOf = (agent: MockAgentWorkspace) =>
    cells.find((cell) => cell.testId === cellTestId(fixture.serverId, agent.workspaceId));
  // A cell beyond the overscan margin (or not drawn at all) is hidden and must not be subscribed.
  // The focused cell stays live wherever it is scrolled to.
  const hiddenAgents = fixture.agents.filter((agent) => {
    const cell = cellOf(agent);
    return cell?.beyondOverscan !== false && cell?.focused !== true;
  });
  const description = {
    mountedCells: cells.length,
    onScreenCells: cells.filter((cell) => cell.onScreen).length,
    focusedCells: cells.filter((cell) => cell.focused).length,
    cellsInOverscanOnly: cells.filter((cell) => !cell.onScreen && !cell.beyondOverscan).length,
    hiddenCells: hiddenAgents.length,
    subscribedAgents: latest.length,
    subscribedWhileHidden: hiddenAgents.filter((agent) => latest.includes(agent.agentId)).length,
    cellTopsAndHeights: cells.map((cell) => [cell.top, cell.height]),
    hiddenButSubscribed: hiddenAgents
      .filter((agent) => latest.includes(agent.agentId))
      .map((agent) => {
        const cell = cellOf(agent);
        return cell ? [cell.top, cell.height] : null;
      }),
  };
  return { description, cells };
}

function summarizeSections(
  rows: readonly RenderProfileRow[],
  cells: readonly CellGeometry[],
  fixture: GridFixture,
) {
  const focusedCell = cells.find((cell) => cell.focused)?.testId;
  return fixture.agents.map((agent) => {
    const row = rows.find((candidate) => candidate.id === `AgentStreamSection:${agent.agentId}`);
    const cell = cells.find(
      (candidate) => candidate.testId === cellTestId(fixture.serverId, agent.workspaceId),
    );
    let role = "overscan";
    if (cell?.testId === focusedCell) role = "focused";
    else if (cell?.onScreen) role = "reduced";
    return {
      role,
      commits: row?.commits ?? 0,
      nestedUpdates: row?.nestedUpdates ?? 0,
      totalMs: row?.totalMs ?? 0,
      maxMs: row?.maxMs ?? 0,
      firstGapsMs: role === "focused" ? [] : (row?.firstGapsMs ?? []),
    };
  });
}

async function sampleWindow(page: Page, durationMs: number): Promise<ProbeResult> {
  await startProbe(page);
  await page.waitForTimeout(durationMs);
  return stopProbe(page);
}

/** Probes only the window around one action, so idle frames between actions do not hide jank. */
async function sampleAction(page: Page, action: () => Promise<void>): Promise<ProbeResult> {
  await startProbe(page);
  await action();
  await page.waitForTimeout(MAXIMIZE_WINDOW_MS);
  return stopProbe(page);
}

/** Sums render profile rows of several windows; `maxMs` keeps the slowest single commit. */
function mergeRenderProfiles(windows: readonly (readonly RenderProfileRow[])[]) {
  const merged = new Map<string, { id: string; commits: number; totalMs: number; maxMs: number }>();
  for (const rows of windows) {
    for (const row of rows) {
      const entry = merged.get(row.id) ?? { id: row.id, commits: 0, totalMs: 0, maxMs: 0 };
      entry.commits += row.commits;
      entry.totalMs += row.totalMs;
      entry.maxMs = Math.max(entry.maxMs, row.maxMs);
      merged.set(row.id, entry);
    }
  }
  const count = Math.max(windows.length, 1);
  return [...merged.values()]
    .sort((a, b) => b.totalMs - a.totalMs)
    .map((entry) => ({
      id: entry.id,
      commitsPerWindow: Math.round((entry.commits / count) * 10) / 10,
      msPerWindow: Math.round(entry.totalMs / count),
      maxMs: Math.round(entry.maxMs),
    }));
}

/** Long task starts are relative to their own probe; a CPU profile needs page time. */
function longTasksInPageTime(probe: ProbeResult) {
  return probe.longTasks.map((task) => ({ ...task, start: task.start + probe.startedAt }));
}

function mergeProbes(probes: readonly ProbeResult[]): ProbeResult {
  return {
    startedAt: probes[0]?.startedAt ?? 0,
    frames: probes.flatMap((probe) => probe.frames),
    longTasks: probes.flatMap((probe) => probe.longTasks),
    durationMs: probes.reduce((sum, probe) => sum + probe.durationMs, 0),
  };
}

// Screen recording and tracing add main-thread and compositor load that would distort the frames.
test.use({ video: "off", trace: "off" });

test.describe("Pinned grid load test", () => {
  test.skip(!RUN, "set PASEO_PINNED_GRID_PERF_E2E=1 to run");
  test.describe.configure({ timeout: 1_200_000 });

  function scenarioTest(
    scenario: Scenario,
    body: (context: { page: Page; fixture: GridFixture }) => Promise<void>,
    viewport = VIEWPORT,
  ) {
    test(scenario, async ({ page }, testInfo) => {
      test.skip(ONLY_SCENARIO !== "" && ONLY_SCENARIO !== scenario, "another scenario selected");
      let fixture: GridFixture | null = null;
      try {
        fixture = await setUpGrid(page, viewport);
        await waitForStreaming(page);
        await body({ page, fixture });
      } finally {
        await testInfo.attach("console-note", { body: scenario, contentType: "text/plain" });
        await tearDownGrid(fixture, []);
      }
    });
  }

  scenarioTest("idle", async ({ page, fixture }) => {
    const grid = await describeGrid(page, fixture);
    report("idle grid", grid.description);
    expect(grid.description.focusedCells).toBe(1);
    expect.soft(grid.description.subscribedWhileHidden, "hidden cells subscribed").toBe(0);

    const cdp: CDPSession = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const heapBefore = await readHeapUsedBytes(page, cdp);
    const finishCpuProfile = await startCpuProfile(page, cdp);
    if (RENDER_PROFILE) await resetRenderProfile(page);
    const stopTrace = TRACE_PATH ? await startChromeTrace(cdp) : null;
    const probe = await sampleWindow(page, IDLE_WINDOW_MS);
    if (stopTrace) await writeFile(TRACE_PATH, JSON.stringify(await stopTrace()));
    if (RENDER_PROFILE) {
      const rows = await readRenderProfile(page);
      const sections = summarizeSections(rows, grid.cells, fixture);
      report("idle render profile (dev bundle)", {
        sections,
        other: rows.filter((row) => !row.id.startsWith("AgentStreamSection:")).slice(0, 10),
      });
    }
    await finishCpuProfile(probe);
    const heapAfter = await readHeapUsedBytes(page, cdp);
    const growth = (heapAfter - heapBefore) / heapBefore;
    report("idle heap", { heapBefore, heapAfter, growth: Math.round(growth * 1000) / 1000 });
    expectFrameAndTaskBudgets("idle", probe);
    expect.soft(growth, "JS heap growth over the window").toBeLessThanOrEqual(HEAP_GROWTH_BUDGET);

    const after = await describeGrid(page, fixture);
    report("idle grid after", after.description);
    expect.soft(after.description.subscribedWhileHidden).toBe(0);
  });

  scenarioTest("typing", async ({ page, fixture }) => {
    const grid = await describeGrid(page, fixture);
    report("typing grid", grid.description);
    const focusedId = grid.cells.find((cell) => cell.focused)?.testId;
    expect(focusedId, "a focused cell").toBeTruthy();
    const focusedCell = page.getByTestId(focusedId ?? "");
    const composer = composerOf(focusedCell);
    await composerPlaceholderOf(focusedCell).click();
    await expect(composer).toBeFocused();

    await startKeystrokeProbe(page);
    await startProbe(page);
    for (let round = 0; round < KEYSTROKE_ROUNDS; round += 1) {
      await page.keyboard.type("x".repeat(KEYSTROKES_PER_ROUND), { delay: KEYSTROKE_DELAY_MS });
      await composer.fill("");
    }
    const probe = await stopProbe(page);
    const latencies = await stopKeystrokeProbe(page);
    const p95 = computePercentile(latencies, 95);
    report("typing keystroke", {
      samples: latencies.length,
      p50: Math.round(computePercentile(latencies, 50) * 100) / 100,
      p95: Math.round(p95 * 100) / 100,
      max: Math.round(Math.max(...latencies) * 100) / 100,
    });
    expect(latencies.length, "keystrokes measured").toBeGreaterThanOrEqual(
      KEYSTROKES_PER_ROUND * KEYSTROKE_ROUNDS * 0.9,
    );
    expect.soft(p95, "keystroke-to-paint p95").toBeLessThanOrEqual(KEYSTROKE_P95_BUDGET_MS);
    expectFrameAndTaskBudgets("typing", probe);
  });

  scenarioTest("scroll", async ({ page, fixture }) => {
    const grid = await describeGrid(page, fixture);
    report("scroll grid", grid.description);
    await startProbe(page);
    const range = await scrollDeckThereAndBack(page);
    const probe = await stopProbe(page);
    report("scroll range", { range });
    expectFrameAndTaskBudgets("scroll", probe);

    // Settle at the bottom, then at the top: cells off screen for more than the hysteresis hold no
    // subscription and cells on screen hold one.
    for (const [name, top] of [
      ["bottom", Number.MAX_SAFE_INTEGER],
      ["top", 0],
    ] as const) {
      await page.getByTestId("workspace-deck").evaluate((deck, target) => {
        deck.scrollTop = target;
      }, top);
      await page.waitForTimeout(4_000);
      const settled = await describeGrid(page, fixture);
      report(`scroll settled at ${name}`, settled.description);
      expect
        .soft(settled.description.subscribedWhileHidden, `${name}: hidden cells subscribed`)
        .toBe(0);
    }
  });

  scenarioTest("focus", async ({ page, fixture }) => {
    const grid = await describeGrid(page, fixture);
    report("focus grid", grid.description);
    const candidates = grid.cells.filter((cell) => cell.onScreen && !cell.focused);
    const stride = Math.max(1, Math.floor(candidates.length / FOCUS_TARGETS));
    const targets = candidates.filter((_, index) => index % stride === 0).slice(0, FOCUS_TARGETS);
    expect(targets.length).toBeGreaterThan(0);

    const cdp: CDPSession = await page.context().newCDPSession(page);
    const finishCpuProfile = await startCpuProfile(page, cdp);
    await startProbe(page);
    const moves: number[] = [];
    for (const target of targets) {
      const pending = observeFocusRing(page, target.testId);
      await composerPlaceholderOf(page.getByTestId(target.testId)).click();
      moves.push(await pending);
      await page.waitForTimeout(1_500);
    }
    const probe = await stopProbe(page);
    await finishCpuProfile(probe);
    report("focus moves", {
      clickToRingMs: moves.map((value) => Math.round(value * 100) / 100),
      secondHost: "not exercised: the harness runs one daemon",
    });
    expectFrameAndTaskBudgets("focus", probe);
  });

  scenarioTest("staleness", async ({ page, fixture }) => {
    const grid = await describeGrid(page, fixture);
    report("staleness grid", grid.description);
    const focusedId = grid.cells.find((cell) => cell.focused)?.testId ?? "";
    await startStalenessProbe(page);
    await page.waitForTimeout(30_000);
    const gapsByCell = await stopStalenessProbe(page);
    const reducedGaps: number[] = [];
    for (const [cellId, gaps] of Object.entries(gapsByCell)) {
      if (cellId !== focusedId) reducedGaps.push(...gaps);
    }
    const p95 = computePercentile(reducedGaps, 95);
    report("staleness reduced cells", {
      cellsObserved: Object.keys(gapsByCell).length,
      gaps: reducedGaps.length,
      p50: Math.round(computePercentile(reducedGaps, 50)),
      p95: Math.round(p95),
      max: Math.round(Math.max(0, ...reducedGaps)),
      focusedGapsP95: Math.round(computePercentile(gapsByCell[focusedId] ?? [], 95)),
    });
    expect(reducedGaps.length, "reduced cells updated while streaming").toBeGreaterThan(100);
    expect
      .soft(p95, "reduced cell update gap p95 (proxy for staleness)")
      .toBeLessThanOrEqual(REDUCED_STALENESS_BUDGET_MS);
  });
  // Maximize and restore of on-screen cells while every agent streams. Only the frames around each
  // action are kept, so the numbers describe the motion itself.
  scenarioTest("maximize", async ({ page, fixture }) => {
    const grid = await describeGrid(page, fixture);
    report("maximize grid", grid.description);
    const targets = grid.cells.filter((cell) => cell.onScreen).slice(0, MAXIMIZE_ROUNDS);
    expect(targets.length).toBeGreaterThan(0);
    const maximizes: ProbeResult[] = [];
    const restores: ProbeResult[] = [];
    const cdp: CDPSession = await page.context().newCDPSession(page);
    const finishCpuProfile = await startCpuProfile(page, cdp);
    // With the render profile on, each action window is profiled on its own, next to an idle window
    // of the same length, so the commits the action adds stand out from the streaming background.
    const renders = { idle: [], maximize: [], restore: [] } as Record<string, RenderProfileRow[][]>;
    const profiled = async <T>(name: string, sample: () => Promise<T>): Promise<T> => {
      if (RENDER_PROFILE) await resetRenderProfile(page);
      const result = await sample();
      if (RENDER_PROFILE) renders[name].push(await readRenderProfile(page));
      return result;
    };
    for (const target of targets) {
      const cell = page.getByTestId(target.testId);
      const button = cell.getByTestId("workspace-grid-cell-maximize");
      if (RENDER_PROFILE) await profiled("idle", () => sampleWindow(page, MAXIMIZE_WINDOW_MS));
      const toggle = () => sampleAction(page, () => button.click());
      maximizes.push(await profiled("maximize", toggle));
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await page.waitForTimeout(MAXIMIZE_REST_MS);
      // Cells parked behind the maximized cell keep their layout and presence but, once the fade
      // settled, hold no timeline subscription: only the maximized cell stays subscribed.
      expect
        .soft(fixture.subscriptions.latest()?.length, "subscribed cells while maximized")
        .toBe(1);
      restores.push(await profiled("restore", toggle));
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await page.waitForTimeout(MAXIMIZE_REST_MS);
    }
    if (RENDER_PROFILE) {
      for (const [name, windows] of Object.entries(renders)) {
        report(`${name} render profile (dev bundle, per window)`, {
          windows: windows.length,
          rows: mergeRenderProfiles(windows).slice(0, 15),
        });
      }
    }
    const all = mergeProbes([...maximizes, ...restores]);
    await finishCpuProfile(all);
    if (CPU_PROFILE_PATH) {
      const longTasks = [...maximizes, ...restores].flatMap(longTasksInPageTime);
      await writeFile(`${CPU_PROFILE_PATH}.longtasks.json`, JSON.stringify(longTasks));
    }
    expectFrameAndTaskBudgets("maximize", mergeProbes(maximizes));
    expectFrameAndTaskBudgets("restore", mergeProbes(restores));
  });
  // The 2560x1440 grid keeps every cell within the overscan margin, so no cell is hidden there. A
  // short viewport pushes the lower rows beyond it, which is where the invariant can be checked
  // under load: hidden cells hold no subscription, and the rest hold one.
  scenarioTest(
    "hidden",
    async ({ page, fixture }) => {
      for (const [name, top] of [
        ["top", 0],
        ["bottom", Number.MAX_SAFE_INTEGER],
      ] as const) {
        await page.getByTestId("workspace-deck").evaluate((deck, target) => {
          deck.scrollTop = target;
        }, top);
        await page.waitForTimeout(5_000);
        report(
          `hidden before settling at ${name}`,
          (await describeGrid(page, fixture)).description,
        );
        await expect
          .poll(async () => (await describeGrid(page, fixture)).description.subscribedWhileHidden, {
            timeout: 15_000,
            message: `${name}: hidden cells leave the subscription`,
          })
          .toBe(0);
        const settled = await describeGrid(page, fixture);
        report(`hidden settled at ${name}`, settled.description);
        expect(settled.description.hiddenCells, `${name}: some cells are hidden`).toBeGreaterThan(
          0,
        );
        expect(settled.description.subscribedAgents).toBe(
          fixture.agents.length - settled.description.hiddenCells,
        );
      }
    },
    HIDDEN_VIEWPORT,
  );
});
