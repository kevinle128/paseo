import type { CDPSession, Page } from "@playwright/test";
import { daemonWsRoutePattern } from "./daemon-port";
import { computePercentile } from "./stream-smoothness";

/**
 * In-page probes and summaries for the pinned grid load test. Every probe runs inside the page so
 * its clock is the clock the app paints on.
 */

declare global {
  interface Window {
    __gridProbe?: {
      frames: number[];
      longTasks: Array<{ start: number; duration: number }>;
      startedAt: number;
      stop(): ProbeResult;
    };
    __gridKeystrokes?: { latencies: number[]; dispose(): void };
    __gridStaleness?: {
      gapsByCell: Record<string, number[]>;
      dispose(): void;
    };
  }
}

export interface ProbeResult {
  /** performance.now() when the probe started; frame k ends at startedAt + sum(frames[0..k]). */
  startedAt: number;
  frames: number[];
  longTasks: Array<{ start: number; duration: number }>;
  durationMs: number;
}

export interface FrameStats {
  frames: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  over33: number;
}

export interface LongTaskStats {
  over50: number;
  over100: number;
  over250: number;
  maxMs: number;
  worstOver100In10s: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Starts recording frame intervals (requestAnimationFrame) and long tasks until {@link stopProbe}. */
export async function startProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__gridProbe?.stop();
    const frames: number[] = [];
    const longTasks: Array<{ start: number; duration: number }> = [];
    const startedAt = performance.now();
    let running = true;
    let last = startedAt;
    const tick = (now: number) => {
      if (!running) return;
      frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push({ start: entry.startTime - startedAt, duration: entry.duration });
      }
    });
    observer.observe({ type: "longtask", buffered: false });
    window.__gridProbe = {
      frames,
      longTasks,
      startedAt,
      stop() {
        running = false;
        observer.disconnect();
        return { frames, longTasks, startedAt, durationMs: performance.now() - startedAt };
      },
    };
  });
}

export async function stopProbe(page: Page): Promise<ProbeResult> {
  return await page.evaluate(() => {
    const probe = window.__gridProbe;
    if (!probe) throw new Error("probe was not started");
    // The observer delivers entries asynchronously; flush before reading.
    return probe.stop();
  });
}

export function summarizeFrames(frames: readonly number[]): FrameStats {
  return {
    frames: frames.length,
    p50: round2(computePercentile(frames, 50)),
    p95: round2(computePercentile(frames, 95)),
    p99: round2(computePercentile(frames, 99)),
    max: round2(frames.length > 0 ? Math.max(...frames) : 0),
    over33: frames.filter((value) => value > 33.4).length,
  };
}

export function summarizeLongTasks(
  tasks: ReadonlyArray<{ start: number; duration: number }>,
): LongTaskStats {
  const bins = new Map<number, number>();
  for (const task of tasks) {
    if (task.duration > 100) {
      const bin = Math.floor(task.start / 10_000);
      bins.set(bin, (bins.get(bin) ?? 0) + 1);
    }
  }
  return {
    over50: tasks.length,
    over100: tasks.filter((task) => task.duration > 100).length,
    over250: tasks.filter((task) => task.duration > 250).length,
    maxMs: round2(tasks.reduce((max, task) => Math.max(max, task.duration), 0)),
    worstOver100In10s: Math.max(0, ...bins.values()),
  };
}

/**
 * Records keystroke-to-paint for every key pressed in the page: from the input event's own
 * timestamp (so queueing behind a busy main thread counts) to a message task queued from the next
 * animation frame (which runs after that frame has been painted).
 */
export async function startKeystrokeProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__gridKeystrokes?.dispose();
    const latencies: number[] = [];
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.length !== 1) return;
      const started = event.timeStamp;
      requestAnimationFrame(() => {
        const channel = new MessageChannel();
        channel.port1.addEventListener("message", () => {
          latencies.push(performance.now() - started);
          channel.port1.close();
        });
        channel.port1.start();
        channel.port2.postMessage(0);
      });
    };
    document.addEventListener("keydown", onKeyDown, true);
    window.__gridKeystrokes = {
      latencies,
      dispose: () => document.removeEventListener("keydown", onKeyDown, true),
    };
  });
}

export async function stopKeystrokeProbe(page: Page): Promise<number[]> {
  return await page.evaluate(() => {
    const probe = window.__gridKeystrokes;
    if (!probe) throw new Error("keystroke probe was not started");
    probe.dispose();
    return probe.latencies;
  });
}

/**
 * Records, per grid cell, the gaps between successive changes of the assistant text in that cell.
 * It stands in for "time between store commit and rendered text": a cell that renders late shows
 * long gaps while its stream is active.
 */
export async function startStalenessProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__gridStaleness?.dispose();
    const gapsByCell: Record<string, number[]> = {};
    const lastByCell = new Map<string, number>();
    const root = document.querySelector('[data-testid="workspace-deck"]') ?? document.body;
    const observer = new MutationObserver((records) => {
      const now = performance.now();
      const touched = new Set<string>();
      for (const record of records) {
        const element =
          record.target instanceof Element ? record.target : record.target.parentElement;
        if (!element?.closest('[data-testid="assistant-message"]')) continue;
        const cell = element.closest('[data-testid^="pinned-grid-cell-"]');
        const id = cell?.getAttribute("data-testid");
        if (id) touched.add(id);
      }
      for (const id of touched) {
        const previous = lastByCell.get(id);
        if (previous !== undefined) (gapsByCell[id] ??= []).push(now - previous);
        lastByCell.set(id, now);
      }
    });
    observer.observe(root, { childList: true, characterData: true, subtree: true });
    window.__gridStaleness = {
      gapsByCell,
      dispose: () => observer.disconnect(),
    };
  });
}

export async function stopStalenessProbe(page: Page): Promise<Record<string, number[]>> {
  return await page.evaluate(() => {
    const probe = window.__gridStaleness;
    if (!probe) throw new Error("staleness probe was not started");
    probe.dispose();
    return probe.gapsByCell;
  });
}

export interface CellGeometry {
  testId: string;
  onScreen: boolean;
  /** Farther from the viewport than the overscan margin, so the cell is expected to be hidden. */
  beyondOverscan: boolean;
  focused: boolean;
  top: number;
  height: number;
}

/** Reads which grid cells intersect the viewport and which one holds the focus ring. */
export async function readCellGeometry(page: Page): Promise<CellGeometry[]> {
  return await page.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-testid^="pinned-grid-cell-"]')];
    return cells.map((cell) => {
      const rect = cell.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0;
      const overscan = window.innerHeight * 0.25;
      return {
        testId: cell.getAttribute("data-testid") ?? "",
        onScreen: visible && rect.bottom > 0 && rect.top < window.innerHeight,
        beyondOverscan:
          !visible || rect.bottom < -overscan || rect.top > window.innerHeight + overscan,
        top: Math.round(rect.top),
        height: Math.round(rect.height),
        focused: cell.querySelector('[data-testid="pinned-grid-focus-ring"]') !== null,
      };
    });
  });
}

export async function readHeapUsedBytes(page: Page, cdp: CDPSession): Promise<number> {
  await cdp.send("HeapProfiler.collectGarbage");
  await page.waitForTimeout(250);
  const { metrics } = await cdp.send("Performance.getMetrics");
  const used = metrics.find((metric) => metric.name === "JSHeapUsedSize");
  if (!used) throw new Error("JSHeapUsedSize was not reported");
  return used.value;
}

function sessionMessage(message: string | Buffer): Record<string, unknown> | null {
  try {
    const envelope = JSON.parse(typeof message === "string" ? message : message.toString("utf8"));
    if (envelope?.type !== "session" || typeof envelope.message !== "object") return null;
    return envelope.message as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The newest timeline subscription is the set of chats the daemon streams to this client. */
export async function recordTimelineSubscriptions(
  page: Page,
): Promise<{ latest(): string[] | null }> {
  const requests: string[][] = [];
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const parsed = sessionMessage(message);
      if (
        parsed?.type === "agent.timeline.set_subscription.request" &&
        Array.isArray(parsed.agentIds)
      ) {
        requests.push(parsed.agentIds.filter((id): id is string => typeof id === "string"));
      }
      server.send(message);
    });
    server.onMessage((message) => ws.send(message));
  });
  return { latest: () => requests.at(-1) ?? null };
}

function scrollDeckInPage(deck: HTMLElement): Promise<number> {
  const range = Math.max(0, deck.scrollHeight - deck.clientHeight);
  const speedPxPerMs = 0.3;
  const legMs = Math.max(1, range / speedPxPerMs);
  const legs = [1, 0, 1, 0];
  const start = performance.now();
  const startTop = deck.scrollTop;
  return new Promise((resolve) => {
    const tick = (now: number) => {
      const elapsed = now - start;
      const leg = Math.min(legs.length - 1, Math.floor(elapsed / legMs));
      const progress = Math.min(1, (elapsed - leg * legMs) / legMs);
      const from = leg === 0 ? startTop : legs[leg - 1] * range;
      deck.scrollTop = from + (legs[leg] * range - from) * progress;
      if (elapsed >= legMs * legs.length) {
        resolve(range);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Scrolls the grid to the bottom and back twice at a steady speed; resolves with the scroll range. */
export async function scrollDeckThereAndBack(page: Page): Promise<number> {
  return await page.getByTestId("workspace-deck").evaluate(scrollDeckInPage);
}

function observeFocusRingInPage(id: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`focus ring never reached ${id}`)), 10_000);
    const finish = (started: number) => {
      const channel = new MessageChannel();
      channel.port1.addEventListener("message", () => {
        clearTimeout(timer);
        resolve(performance.now() - started);
      });
      channel.port1.start();
      channel.port2.postMessage(0);
    };
    const onDown = (event: Event) => {
      document.removeEventListener("pointerdown", onDown, true);
      const started = event.timeStamp;
      const poll = () => {
        const selector = `[data-testid="${id}"] [data-testid="pinned-grid-focus-ring"]`;
        if (document.querySelector(selector)) {
          requestAnimationFrame(() => finish(started));
          return;
        }
        requestAnimationFrame(poll);
      };
      poll();
    };
    document.addEventListener("pointerdown", onDown, true);
  });
}

/**
 * Arms a listener for the next pointer press and resolves with the time from that press to the
 * frame that painted the focus ring in the given cell. Await it after performing the click.
 */
export function observeFocusRing(page: Page, cellTestId: string): Promise<number> {
  return page.evaluate(observeFocusRingInPage, cellTestId);
}

export interface RenderProfileRow {
  id: string;
  commits: number;
  nestedUpdates: number;
  totalMs: number;
  maxMs: number;
  /** Gaps between the first commits, in ms, to show whether commits come in bursts. */
  firstGapsMs: number[];
}

/** Turns on the app's React Profiler capture for every page load (development bundles only). */
export async function enableRenderProfile(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Reflect.set(globalThis, "__PASEO_RENDER_PROFILE_ENABLED__", true);
  });
}

export async function resetRenderProfile(page: Page): Promise<void> {
  await page.evaluate(() => globalThis.__PASEO_RESET_RENDER_PROFILE__?.());
}

/** Commit counts and render time per profiled component; stream sections stay per agent. */
export async function readRenderProfile(page: Page): Promise<RenderProfileRow[]> {
  const samples = await page.evaluate(
    () =>
      (globalThis.__PASEO_RENDER_PROFILE__ ?? []).map((sample) => [
        sample.id,
        sample.actualDuration,
        sample.phase,
        sample.commitTime,
      ]) as Array<[string, number, string, number]>,
  );
  const lastCommitAt = new Map<string, number>();
  const rows = new Map<string, RenderProfileRow>();
  for (const [id, duration, phase, commitTime] of samples) {
    // Per-agent sections keep their agent id; every other id folds to its first two segments.
    const key = id.startsWith("AgentStreamSection:") ? id : id.split(":").slice(0, 2).join(":");
    const row = rows.get(key) ?? {
      id: key,
      commits: 0,
      nestedUpdates: 0,
      totalMs: 0,
      maxMs: 0,
      firstGapsMs: [],
    };
    row.commits += 1;
    if (phase === "nested-update") row.nestedUpdates += 1;
    const previousCommit = lastCommitAt.get(key);
    if (previousCommit !== undefined && row.firstGapsMs.length < 40) {
      row.firstGapsMs.push(Math.round(commitTime - previousCommit));
    }
    lastCommitAt.set(key, commitTime);
    row.totalMs += duration;
    row.maxMs = Math.max(row.maxMs, duration);
    rows.set(key, row);
  }
  return [...rows.values()]
    .sort((a, b) => b.totalMs - a.totalMs)
    .map((row) => ({
      id: row.id,
      commits: row.commits,
      nestedUpdates: row.nestedUpdates,
      totalMs: round2(row.totalMs),
      maxMs: round2(row.maxMs),
      firstGapsMs: row.firstGapsMs,
    }));
}

/**
 * Starts a Chromium performance trace (the data behind the DevTools Performance panel). The
 * returned function stops it and resolves with the trace events.
 */
export async function startChromeTrace(cdp: CDPSession): Promise<() => Promise<unknown[]>> {
  const events: unknown[] = [];
  cdp.on("Tracing.dataCollected", (chunk) => {
    events.push(...chunk.value);
  });
  await cdp.send("Tracing.start", {
    transferMode: "ReportEvents",
    traceConfig: {
      includedCategories: [
        "devtools.timeline",
        "disabled-by-default-devtools.timeline",
        "v8",
        "cc",
      ],
    },
  });
  return async () => {
    const complete = new Promise<void>((resolve) => {
      cdp.once("Tracing.tracingComplete", () => resolve());
    });
    await cdp.send("Tracing.end");
    await complete;
    return events;
  };
}
