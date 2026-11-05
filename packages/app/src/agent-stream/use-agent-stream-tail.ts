import { useEffect, useReducer, useRef } from "react";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useStreamFidelity } from "@/pinned-grid/stream-fidelity-context";
import { useSessionStore } from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";

type SessionStoreState = ReturnType<typeof useSessionStore.getState>;

/**
 * Selects from the session store. A reduced pinned-grid cell keeps returning the last delivered
 * value, so store updates schedule no render, and the cell's tick delivers the latest value once
 * per clock period. `gateKey` names what is selected; a new key starts from the current value.
 * Outside a reduced cell this is a plain store selector.
 */
export function useFidelityGatedSelector<T>(
  gateKey: string,
  select: (state: SessionStoreState) => T,
): T {
  const { fidelity, tick } = useStreamFidelity();
  const reduced = fidelity === "reduced" && tick !== null;
  const [, deliver] = useReducer((count: number) => count + 1, 0);
  const delivered = useRef<{ key: string; value: T } | null>(null);
  const selectRef = useRef(select);
  selectRef.current = select;

  const selected = useSessionStore((state): T => {
    const live = select(state);
    if (!reduced) {
      delivered.current = null;
      return live;
    }
    if (delivered.current?.key !== gateKey) {
      delivered.current = { key: gateKey, value: live };
    }
    return delivered.current.value;
  });

  useEffect(() => {
    if (!reduced) {
      return undefined;
    }
    return tick.subscribe(() => {
      const current = delivered.current;
      const live = selectRef.current(useSessionStore.getState());
      if (current && current.value !== live) {
        delivered.current = { key: current.key, value: live };
        deliver();
      }
    });
  }, [reduced, tick]);

  return selected;
}

// The view retains its last visible transcript. Selecting a stable value here
// also prevents incoming chunks from scheduling React work in a hidden panel.
// Revealing the panel reads the current tail directly from the model.
//
// A reduced pinned-grid cell gets the latest tail once per clock tick instead of per event.
export function useAgentStreamTail(
  serverId: string,
  agentId: string | undefined,
): StreamItem[] | undefined {
  const active = useRetainedPanelActive();
  return useFidelityGatedSelector(`tail:${serverId}:${agentId}:${active}`, (state) =>
    active && agentId ? state.sessions[serverId]?.agentStreamTail.get(agentId) : undefined,
  );
}
