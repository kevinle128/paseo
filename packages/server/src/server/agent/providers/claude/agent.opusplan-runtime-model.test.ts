import { expect, test } from "vitest";
import type { PermissionMode, Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import type { AgentStreamEvent } from "../../agent-sdk-types.js";
import { ClaudeAgentClient } from "./agent.js";
import type { ClaudeQueryInput } from "./query.js";

const OUTSIDE_PLAN_MODEL = "claude-sonnet-5-5";
const PLAN_MODEL = "claude-opus-4-8";

// Mimics the CLI under opusplan: init always reports the outside-plan model, while the model
// that answers a turn depends on the permission mode when the turn starts.
class OpusPlanQuery {
  private mode: PermissionMode;
  private readonly output: AsyncGenerator<SDKMessage>;

  constructor(input: ClaudeQueryInput) {
    this.mode = (input.options.permissionMode ?? "default") as PermissionMode;
    this.output = this.events(input);
  }

  private async *events(input: ClaudeQueryInput): AsyncGenerator<SDKMessage> {
    if (typeof input.prompt === "string") throw new Error("Expected streaming input");
    for await (const _prompt of input.prompt) {
      yield {
        type: "system",
        subtype: "init",
        session_id: "opusplan-session",
        model: OUTSIDE_PLAN_MODEL,
        permissionMode: this.mode,
      } as SDKMessage;
      yield {
        type: "assistant",
        message: {
          model: this.mode === "plan" ? PLAN_MODEL : OUTSIDE_PLAN_MODEL,
          content: [{ type: "text", text: "ok" }],
        },
      } as SDKMessage;
      yield {
        type: "result",
        subtype: "success",
        usage: { input_tokens: 1, cache_read_input_tokens: 0, output_tokens: 1 },
        total_cost_usd: 0,
      } as SDKMessage;
    }
  }

  next() {
    return this.output.next();
  }
  return() {
    return this.output.return();
  }
  close() {}
  async interrupt() {}
  async setPermissionMode(next: PermissionMode) {
    this.mode = next;
  }
  async setModel() {}
  async supportedCommands() {
    return [];
  }
  [Symbol.asyncIterator]() {
    return this;
  }
}

async function createOpusPlanSession(model: string, modeId: PermissionMode) {
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    resolveBinary: async () => "/test/claude",
    queryFactory: (input) => new OpusPlanQuery(input) as unknown as Query,
  });
  const session = await client.createSession({
    provider: "claude",
    cwd: process.cwd(),
    model,
    modeId,
  });
  async function runTurn(prompt: string) {
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const unsubscribe = session.subscribe((event: AgentStreamEvent) => {
      if (event.type === "turn_completed" || event.type === "turn_failed") finish();
    });
    await session.startTurn(prompt);
    await done;
    unsubscribe();
  }
  return { session, runTurn };
}

test("an opusplan session reports the model that answered in each mode", async () => {
  const { session, runTurn } = await createOpusPlanSession("opusplan", "acceptEdits");
  try {
    await runTurn("outside plan");
    expect(await session.getRuntimeInfo()).toMatchObject({
      model: "opusplan",
      extra: { runtimeModel: OUTSIDE_PLAN_MODEL },
    });

    await session.setMode("plan");
    await runTurn("inside plan");
    expect((await session.getRuntimeInfo()).extra?.runtimeModel).toBe(PLAN_MODEL);

    await session.setMode("acceptEdits");
    // The outside-plan model is already known, so leaving plan mode shows it before the next turn.
    expect((await session.getRuntimeInfo()).extra?.runtimeModel).toBe(OUTSIDE_PLAN_MODEL);
  } finally {
    await session.close();
  }
});

test("a chat /model command makes the session follow the model the CLI switched to", async () => {
  const { session, runTurn } = await createOpusPlanSession("claude-opus-4-8", "acceptEdits");
  try {
    await runTurn("/model opusplan");
    expect(await session.getRuntimeInfo()).toMatchObject({ model: "opusplan" });
  } finally {
    await session.close();
  }
});
