import { expect, test } from "vitest";
import type { PermissionMode, Query } from "@anthropic-ai/claude-agent-sdk";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import { ClaudeAgentClient } from "./agent.js";

async function createOpusPlanSession(modeId: PermissionMode) {
  const sdkModes: PermissionMode[] = [];
  const query = Object.assign((async function* () {})(), {
    async setPermissionMode(next: PermissionMode) {
      sdkModes.push(next);
    },
    async setModel() {},
    close() {},
  });
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    resolveBinary: async () => "/test/claude",
    queryFactory: () => query as Query,
  });
  const session = await client.createSession({
    provider: "claude",
    cwd: process.cwd(),
    model: "opusplan",
    modeId,
  });
  const events: AgentStreamEvent[] = [];
  session.subscribe((event) => events.push(event));
  const modeChanges = () =>
    events.flatMap((event) => (event.type === "mode_changed" ? [event.currentModeId] : []));
  return { session, sdkModes, modeChanges };
}

test("a plan skill announces plan mode again after the host left plan mode", async () => {
  const { session, sdkModes, modeChanges } = await createOpusPlanSession("plan");
  try {
    await session.setMode("acceptEdits");
    expect(await session.getRuntimeInfo()).toMatchObject({ modeId: "acceptEdits" });

    await session.startTurn("/ak:ak-plan build the thing");

    expect(sdkModes.at(-1)).toBe("plan");
    expect(modeChanges()).toEqual(["plan"]);
    // The cached runtime info must follow the switch rather than report the earlier mode.
    expect(await session.getRuntimeInfo()).toMatchObject({ modeId: "plan" });
  } finally {
    await session.close();
  }
});
