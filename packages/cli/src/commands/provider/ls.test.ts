import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { renderJson } from "../../output/json.js";
import { runLsCommand } from "./ls.js";

const getProvidersSnapshot = vi.fn<() => Promise<{ entries: ProviderSnapshotEntry[] }>>();
const close = vi.fn(async () => undefined);

vi.mock("../../utils/client.js", () => ({
  connectToDaemon: vi.fn(async () => ({
    getProvidersSnapshot,
    close,
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("provider ls command", () => {
  it("includes extends in JSON output when present and omits it when absent", async () => {
    getProvidersSnapshot.mockResolvedValue({
      entries: [
        {
          provider: "claude",
          status: "ready",
          enabled: true,
          source: "builtin",
          label: "Claude",
          defaultModeId: "default",
          modes: [{ id: "default", label: "Default", description: "Default" }],
        },
        {
          provider: "cursor-peer",
          status: "ready",
          enabled: true,
          source: "custom",
          extends: "cursor",
          label: "Cursor Peer",
          defaultModeId: null,
          modes: [],
        },
      ],
    });

    const result = await runLsCommand(
      { daemonTarget: { kind: "instance", home: "/tmp/provider-ls-test" } },
      {} as never,
    );
    const parsed = JSON.parse(
      renderJson(result, { format: "json", quiet: false, color: false }),
    ) as Array<Record<string, unknown>>;
    const claude = parsed.find((entry) => entry.provider === "claude");
    const cursorPeer = parsed.find((entry) => entry.provider === "cursor-peer");

    expect(cursorPeer).toMatchObject({
      provider: "cursor-peer",
      extends: "cursor",
    });
    expect(claude).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(claude, "extends")).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
