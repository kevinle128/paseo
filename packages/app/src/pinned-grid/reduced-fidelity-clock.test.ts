import { describe, expect, it } from "vitest";
import { ReducedFidelityClock } from "./reduced-fidelity-clock";

class FakeScheduler {
  time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; run: () => void }>();

  readonly deps = {
    setTimeout: (run: () => void, delayMs: number) => {
      const id = this.nextId;
      this.nextId += 1;
      this.timers.set(id, { at: this.time + delayMs, run });
      return id;
    },
    clearTimeout: (id: number) => {
      this.timers.delete(id);
    },
    now: () => this.time,
  };

  get pendingTimers(): number {
    return this.timers.size;
  }

  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) {
        break;
      }
      this.timers.delete(next[0]);
      this.time = Math.max(this.time, next[1].at);
      next[1].run();
    }
    this.time = target;
  }
}

function setup(options = { periodMs: 100, slots: 10 }) {
  const scheduler = new FakeScheduler();
  const clock = new ReducedFidelityClock(scheduler.deps, options);
  return { scheduler, clock };
}

describe("ReducedFidelityClock", () => {
  it("ticks each subscriber once per period", () => {
    const { scheduler, clock } = setup();
    const counts = [0, 0, 0];
    const countTicksOf = (index: number) =>
      clock.subscribe(() => {
        counts[index] += 1;
      });
    countTicksOf(0);
    countTicksOf(1);
    countTicksOf(2);
    scheduler.advance(100);
    expect(counts).toEqual([1, 1, 1]);
    scheduler.advance(300);
    expect(counts).toEqual([4, 4, 4]);
  });

  it("spreads subscribers over slots so one wake runs at most one", () => {
    const { scheduler, clock } = setup();
    const perWake: number[] = [];
    let current = 0;
    for (let i = 0; i < 10; i += 1) {
      clock.subscribe(() => {
        current += 1;
      });
    }
    for (let wake = 0; wake < 10; wake += 1) {
      current = 0;
      scheduler.advance(10);
      perWake.push(current);
    }
    expect(perWake).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("keeps a wake small when there are more subscribers than slots", () => {
    const { scheduler, clock } = setup();
    let current = 0;
    let max = 0;
    for (let i = 0; i < 15; i += 1) {
      clock.subscribe(() => {
        current += 1;
      });
    }
    for (let wake = 0; wake < 10; wake += 1) {
      current = 0;
      scheduler.advance(10);
      max = Math.max(max, current);
    }
    expect(max).toBe(2);
  });

  it("stops ticking after unsubscribe and runs no timer with zero subscribers", () => {
    const { scheduler, clock } = setup();
    let ticks = 0;
    const stop = clock.subscribe(() => {
      ticks += 1;
    });
    expect(scheduler.pendingTimers).toBe(1);
    scheduler.advance(100);
    expect(ticks).toBe(1);
    stop();
    expect(scheduler.pendingTimers).toBe(0);
    expect(clock.isRunning).toBe(false);
    scheduler.advance(1_000);
    expect(ticks).toBe(1);
  });

  it("runs no timer before the first subscriber and restarts after the last leaves", () => {
    const { scheduler, clock } = setup();
    expect(scheduler.pendingTimers).toBe(0);
    let ticks = 0;
    clock.subscribe(() => undefined)();
    clock.subscribe(() => {
      ticks += 1;
    });
    scheduler.advance(100);
    expect(ticks).toBe(1);
  });

  it("keeps ticking the others when one subscriber throws", () => {
    const { scheduler, clock } = setup({ periodMs: 100, slots: 1 });
    let ticks = 0;
    clock.subscribe(() => {
      throw new Error("boom");
    });
    clock.subscribe(() => {
      ticks += 1;
    });
    expect(() => scheduler.advance(100)).toThrow("boom");
    expect(ticks).toBe(1);
    expect(() => scheduler.advance(100)).toThrow("boom");
    expect(ticks).toBe(2);
  });

  it("rejects an invalid configuration", () => {
    const scheduler = new FakeScheduler();
    expect(() => new ReducedFidelityClock(scheduler.deps, { periodMs: 0, slots: 5 })).toThrow();
    expect(() => new ReducedFidelityClock(scheduler.deps, { periodMs: 100, slots: 0 })).toThrow();
  });
});
