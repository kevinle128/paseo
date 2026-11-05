export interface ReducedFidelityClockDeps<Handle = unknown> {
  setTimeout(callback: () => void, delayMs: number): Handle;
  clearTimeout(handle: Handle): void;
  now(): number;
}

export interface ReducedFidelityClockOptions {
  /** Every subscriber ticks once per period. */
  periodMs: number;
  /** The period is cut into this many slots; one wake runs the subscribers of one slot. */
  slots: number;
}

/** A reduced cell is never older than 250 ms; 15 slots is about one wake per 60 Hz frame. */
export const REDUCED_FIDELITY_PERIOD_MS = 250;
export const REDUCED_FIDELITY_SLOTS = 15;

/**
 * One timer for the whole grid. Reduced cells subscribe and receive one tick per period. A
 * subscriber joins the emptiest slot, so ticks spread across the period and one wake renders at
 * most a cell or two instead of every cell at once. The timer runs only while someone listens.
 */
export class ReducedFidelityClock<Handle = unknown> {
  private readonly slotSubscribers: Array<Set<() => void>>;
  private readonly slotOfSubscriber = new Map<() => void, number>();
  private readonly stepMs: number;
  private timer: Handle | null = null;
  private startedAt = 0;
  private wakeCount = 0;

  constructor(
    private readonly deps: ReducedFidelityClockDeps<Handle>,
    options: ReducedFidelityClockOptions,
  ) {
    if (!(options.periodMs > 0) || !Number.isInteger(options.slots) || options.slots < 1) {
      throw new Error("ReducedFidelityClock needs a positive period and at least one slot");
    }
    this.slotSubscribers = Array.from({ length: options.slots }, () => new Set());
    this.stepMs = options.periodMs / options.slots;
  }

  subscribe(onTick: () => void): () => void {
    // Each call is its own subscription, even for a repeated callback.
    const subscriber = () => onTick();
    const slot = this.emptiestSlot();
    this.slotSubscribers[slot].add(subscriber);
    this.slotOfSubscriber.set(subscriber, slot);
    if (this.timer === null) {
      this.start();
    }
    return () => {
      const owned = this.slotOfSubscriber.get(subscriber);
      if (owned === undefined) {
        return;
      }
      this.slotOfSubscriber.delete(subscriber);
      this.slotSubscribers[owned].delete(subscriber);
      if (this.slotOfSubscriber.size === 0) {
        this.stop();
      }
    };
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  private emptiestSlot(): number {
    let best = 0;
    for (let slot = 1; slot < this.slotSubscribers.length; slot += 1) {
      if (this.slotSubscribers[slot].size < this.slotSubscribers[best].size) {
        best = slot;
      }
    }
    return best;
  }

  private start(): void {
    this.startedAt = this.deps.now();
    this.wakeCount = 0;
    this.scheduleNext();
  }

  private stop(): void {
    if (this.timer !== null) {
      this.deps.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    const due = this.startedAt + (this.wakeCount + 1) * this.stepMs;
    this.timer = this.deps.setTimeout(() => this.wake(), Math.max(0, due - this.deps.now()));
  }

  private wake(): void {
    const slot = this.wakeCount % this.slotSubscribers.length;
    this.wakeCount += 1;
    this.timer = null;
    // Schedule before running subscribers so a throwing subscriber cannot stop the clock.
    if (this.slotOfSubscriber.size > 0) {
      this.scheduleNext();
    }
    let firstError: unknown;
    let failed = false;
    for (const subscriber of this.slotSubscribers[slot]) {
      try {
        subscriber();
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
    if (failed) {
      throw firstError;
    }
  }
}

export function createReducedFidelityClock(): ReducedFidelityClock {
  return new ReducedFidelityClock<ReturnType<typeof setTimeout>>(
    {
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (handle) => clearTimeout(handle),
      now: () => Date.now(),
    },
    { periodMs: REDUCED_FIDELITY_PERIOD_MS, slots: REDUCED_FIDELITY_SLOTS },
  );
}
