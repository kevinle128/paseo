/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act } from "@testing-library/react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RetainedPanelActivity } from "@/components/retained-panel";
import { ReducedFidelityClock } from "@/pinned-grid/reduced-fidelity-clock";
import { StreamFidelityProvider, type StreamFidelity } from "@/pinned-grid/stream-fidelity-context";
import { useSessionStore } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import { useAgentStreamTail, useFidelityGatedSelector } from "./use-agent-stream-tail";

const SERVER_ID = "srv";
const AGENT_ID = "agent-1";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function item(id: string): StreamItem {
  return { kind: "assistant_message", id, text: id, timestamp: new Date(0) } as StreamItem;
}

function setTail(items: StreamItem[]): void {
  act(() => {
    useSessionStore.getState().setAgentStreamTail(SERVER_ID, new Map([[AGENT_ID, items]]));
  });
}

class ManualScheduler {
  private callback: (() => void) | null = null;
  readonly deps = {
    setTimeout: (callback: () => void) => {
      this.callback = callback;
      return 1;
    },
    clearTimeout: () => {
      this.callback = null;
    },
    now: () => 0,
  };
  /** Runs every pending wake until each subscriber ticked once (one slot, one period). */
  tick(): void {
    const run = this.callback;
    this.callback = null;
    run?.();
  }
}

describe("useAgentStreamTail", () => {
  let container: HTMLDivElement;
  let root: Root;
  let renders: Array<StreamItem[] | undefined>;
  let scheduler: ManualScheduler;
  let clock: ReducedFidelityClock;

  function Probe({ active = true }: { active?: boolean }) {
    return (
      <RetainedPanelActivity active={active}>
        <Reader />
      </RetainedPanelActivity>
    );
  }
  function Reader() {
    const tail = useAgentStreamTail(SERVER_ID, AGENT_ID);
    renders.push(tail);
    return null;
  }

  function mount(fidelity: StreamFidelity, active = true) {
    act(() => {
      root.render(
        <StreamFidelityProvider fidelity={fidelity} clock={clock}>
          <Probe active={active} />
        </StreamFidelityProvider>,
      );
    });
  }

  beforeEach(() => {
    renders = [];
    scheduler = new ManualScheduler();
    clock = new ReducedFidelityClock(scheduler.deps, { periodMs: 100, slots: 1 });
    container = document.createElement("div");
    root = createRoot(container);
    useSessionStore.getState().initializeSession(SERVER_ID, null as never);
    setTail([item("a")]);
  });

  afterEach(() => {
    act(() => root.unmount());
    useSessionStore.getState().clearSession(SERVER_ID);
  });

  it("renders every store update in full fidelity", () => {
    mount("full");
    renders.length = 0;
    setTail([item("a"), item("b")]);
    setTail([item("a"), item("b"), item("c")]);
    expect(renders).toHaveLength(2);
    expect(renders.at(-1)?.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("shows the current transcript on first render in reduced fidelity", () => {
    mount("reduced");
    expect(renders.at(-1)?.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("does not render between ticks in reduced fidelity", () => {
    mount("reduced");
    renders.length = 0;
    setTail([item("a"), item("b")]);
    setTail([item("a"), item("b"), item("c")]);
    expect(renders).toHaveLength(0);
  });

  it("renders once per tick with the latest snapshot", () => {
    mount("reduced");
    renders.length = 0;
    setTail([item("a"), item("b")]);
    setTail([item("a"), item("b"), item("c")]);
    act(() => scheduler.tick());
    expect(renders).toHaveLength(1);
    expect(renders[0]?.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
  });

  it("does not render on a tick when nothing changed", () => {
    mount("reduced");
    renders.length = 0;
    act(() => scheduler.tick());
    act(() => scheduler.tick());
    expect(renders).toHaveLength(0);
  });

  it("returns to live updates when the cell becomes full", () => {
    mount("reduced");
    setTail([item("a"), item("b")]);
    mount("full");
    expect(renders.at(-1)?.map((entry) => entry.id)).toEqual(["a", "b"]);
    renders.length = 0;
    setTail([item("a"), item("b"), item("c")]);
    expect(renders).toHaveLength(1);
  });

  it("stops following the clock after unmount", () => {
    mount("reduced");
    act(() => root.render(null));
    expect(clock.isRunning).toBe(false);
  });

  it("delivers the tail and the head of one cell in the same render", () => {
    const pairs: Array<{ tail: number; head: number }> = [];
    function PairReader() {
      const tail = useAgentStreamTail(SERVER_ID, AGENT_ID);
      const head = useFidelityGatedSelector(`head:${SERVER_ID}:${AGENT_ID}`, (state) =>
        state.sessions[SERVER_ID]?.agentStreamHead.get(AGENT_ID),
      );
      pairs.push({ tail: tail?.length ?? 0, head: head?.length ?? 0 });
      return null;
    }
    act(() => {
      root.render(
        <StreamFidelityProvider fidelity="reduced" clock={clock}>
          <PairReader />
        </StreamFidelityProvider>,
      );
    });
    pairs.length = 0;
    act(() => {
      useSessionStore
        .getState()
        .setAgentStreamTail(SERVER_ID, new Map([[AGENT_ID, [item("a"), item("b")]]]));
      useSessionStore.getState().setAgentStreamHead(SERVER_ID, new Map([[AGENT_ID, []]]));
    });
    expect(pairs).toHaveLength(0);
    act(() => scheduler.tick());
    expect(pairs).toEqual([{ tail: 2, head: 0 }]);
  });
});
