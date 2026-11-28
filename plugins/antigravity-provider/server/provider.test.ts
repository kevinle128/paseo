import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  PROVIDER_CAPABILITIES,
  ProviderEventSchema,
  type ProviderConnection,
  type ProviderContent,
  type ProviderEvent,
  type ProviderInput,
  type ProviderLaunch,
  type ProviderPersistence,
  type ProviderSessionConfig,
} from "@getpaseo/plugin/server/provider";
import { createAntigravityProvider } from "./provider.js";

const temporary: string[] = [];
const connections: ProviderConnection[] = [];
const fake = fileURLToPath(new URL("../test/agy.mjs", import.meta.url));
const provider = createAntigravityProvider();

afterEach(async () => {
  await Promise.all(connections.splice(0).map((connection) => connection.close()));
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function harness(env: Record<string, string> = {}) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "antigravity-test-"));
  temporary.push(cwd);
  const log = path.join(cwd, "argv.ndjson");
  const launch: ProviderLaunch = {
    command: process.execPath,
    args: [fake, "--launch-prefix"],
    env: { AGY_TEST_LOG: log, ...env },
  };
  const connection = await provider.connect({
    versions: [1],
    capabilities: PROVIDER_CAPABILITIES,
    launch,
  });
  connections.push(connection);
  const events: ProviderEvent[] = [];
  connection.onEvent((event) => {
    ProviderEventSchema.parse(event);
    events.push(event);
  });
  async function wait(predicate: (event: ProviderEvent) => boolean, timeout = 5000) {
    await expect.poll(() => events.some(predicate), { timeout, interval: 10 }).toBe(true);
    const event = events.find(predicate);
    if (!event) throw new Error("Expected event missing");
    return event;
  }
  async function request(input: ProviderInput, timeout?: number) {
    await connection.send(input);
    if ("requestId" in input) {
      await wait(
        (event) =>
          "requestId" in event &&
          event.requestId === input.requestId &&
          (event.type === "request.completed" ||
            event.type === "request.failed" ||
            event.type === "session.ready" ||
            event.type === "catalog" ||
            event.type === "sessions"),
        timeout,
      );
    }
  }
  async function open(
    options: {
      restored?: ProviderPersistence;
      history?: "replay" | "skip";
      sessionId?: string;
      config?: Partial<ProviderSessionConfig>;
    } = {},
  ) {
    const sessionId = options.sessionId ?? "s";
    await request({
      type: "session.open",
      requestId: `open-${events.length}`,
      sessionId,
      persistence: options.restored,
      history: options.history ?? "replay",
      config: {
        cwd,
        env: { AGY_SESSION_VALUE: "session-overlay" },
        settings: {},
        mcpServers: {},
        persist: true,
        systemPrompt: "SYSTEM PREFIX",
        ...options.config,
      },
    });
  }
  async function message(content: ProviderContent[], sessionId = "s") {
    const clientMessageId = `prompt-${events.length}`;
    await connection.send({
      type: "session.prompt",
      sessionId,
      prompt: {
        clientMessageId,
        delivery: "auto",
        input: { type: "message", content },
      },
    });
    await wait(
      (event) =>
        event.type === "session.prompt_result" && event.clientMessageId === clientMessageId,
    );
    return clientMessageId;
  }
  function prompt(text: string, sessionId = "s") {
    return message([{ type: "text", text }], sessionId);
  }
  async function completed(clientMessageId: string) {
    const result = events.find(
      (event) =>
        event.type === "session.prompt_result" && event.clientMessageId === clientMessageId,
    );
    if (!result || result.type !== "session.prompt_result" || result.result.type !== "turn") {
      throw new Error("Prompt was not admitted");
    }
    const turnId = result.result.turnId;
    return wait(
      (event) =>
        event.type === "session.turn" && event.turnId === turnId && event.state !== "started",
    );
  }
  async function records() {
    return (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  }
  function persistence(sessionId = "s") {
    const opened = events.findLast(
      (event) => event.type === "session.opened" && event.sessionId === sessionId,
    );
    if (!opened || opened.type !== "session.opened" || !opened.persistence) {
      throw new Error("Missing persistence");
    }
    return opened.persistence;
  }
  return {
    connection,
    events,
    launch,
    cwd,
    wait,
    request,
    open,
    prompt,
    message,
    completed,
    records,
    persistence,
  };
}

it("publishes a monochrome, theme-aware provider icon", async () => {
  const icon = await readFile(new URL("../icon.svg", import.meta.url), "utf8");
  expect(icon).toContain('viewBox="0 0 24 24"');
  expect(icon).toContain('fill="currentColor"');
  expect(icon).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(|url\(/i);
  expect(icon).not.toMatch(/<(?:style|mask|defs|linearGradient|radialGradient)\b|\bid=/i);
  expect([...icon.matchAll(/\b(?:fill|stroke)="([^"]+)"/g)].map((match) => match[1])).toEqual([
    "currentColor",
  ]);
});

describe("status and catalog discovery", () => {
  it("reports missing, old, unauthenticated and ACP-capable launches", async () => {
    expect(await provider.status?.({})).toMatchObject({
      available: false,
      diagnostic: expect.stringContaining("agy not found"),
    });
    const missing = await harness();
    expect(
      await provider.status?.({
        launch: { ...missing.launch, command: path.join(missing.cwd, "missing-agy") },
      }),
    ).toMatchObject({ available: false, diagnostic: expect.stringContaining("ENOENT") });

    const old = await harness({ AGY_TEST_VERSION: "1.5.14" });
    expect(await provider.status?.({ launch: old.launch })).toMatchObject({
      available: false,
      diagnostic: expect.stringContaining("1.5.15"),
    });

    const unauthenticated = await harness({ AGY_TEST_AUTH: "missing" });
    expect(await provider.status?.({ launch: unauthenticated.launch })).toEqual({
      available: false,
      diagnostic: "Antigravity authentication failed. Run `agy` and sign in, then retry.",
    });

    for (const version of ["1.5.15", "1.5.18", "1.6.0"]) {
      const ok = await harness({ AGY_TEST_VERSION: version });
      expect(await provider.status?.({ launch: ok.launch })).toEqual({ available: true });
    }
  });

  it("normalizes bare `agy` command overrides to `agy acp` in catalog cache keys", async () => {
    const h = await harness();
    const withoutAcp = await provider.getCatalogCacheKey?.({ scope: "global", launch: h.launch });
    const withAcp = await provider.getCatalogCacheKey?.({
      scope: "workspace",
      cwd: h.cwd,
      launch: { ...h.launch, args: [...h.launch.args, "acp"] },
    });
    expect(withoutAcp).toMatch(/^[a-f0-9]{64}$/);
    expect(withAcp).toBe(withoutAcp);
    expect(
      await provider.getCatalogCacheKey?.({
        scope: "global",
        launch: { ...h.launch, env: { ...h.launch.env, HOME: "different" } },
      }),
    ).not.toBe(withoutAcp);
  });

  it("enriches catalog models with per-family thinking options/aliases and exposes interactive + full-access modes", async () => {
    const h = await harness();
    await h.request({ type: "catalog", requestId: "cat-1", cwd: h.cwd });
    const catalogEvent = h.events.find((event) => event.type === "catalog");
    if (!catalogEvent || catalogEvent.type !== "catalog") throw new Error("Missing catalog");

    const neon = catalogEvent.catalog.models.find((m) => m.id === "gemini-4-neon");
    expect(neon).toMatchObject({
      id: "gemini-4-neon",
      label: "Gemini 4 Neon",
      defaultThinkingOptionId: "high",
      thinkingOptions: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra" },
      ],
      aliases: [
        "gemini-4-neon-low",
        "gemini-4-neon-medium",
        "gemini-4-neon-high",
        "gemini-4-neon-xhigh",
      ],
    });
    const flash = catalogEvent.catalog.models.find((m) => m.id === "gemini-3.8-flash");
    expect(flash?.defaultThinkingOptionId).toBe("high");
    const claude = catalogEvent.catalog.models.find((m) => m.id === "claude-sonnet-4-6");
    expect(claude?.thinkingOptions).toEqual([]);
    expect(claude?.defaultThinkingOptionId).toBeUndefined();
    expect(catalogEvent.catalog.defaultThinkingOption).toBeUndefined();

    expect(catalogEvent.catalog.modes.map((m) => m.id)).toEqual([
      "default",
      "accept-edits",
      "plan",
      "full-access",
    ]);
    expect(catalogEvent.catalog.modes.find((m) => m.id === "full-access")).toMatchObject({
      label: "Full access",
      icon: "ShieldOff",
      colorTier: "dangerous",
      isUnattended: true,
    });
  });
});

describe("sessions, persistence and history replay", () => {
  it("opens over ACP, forwards systemPrompt via _meta.antigravity, streams commands/images/usage and lists sessions", async () => {
    const h = await harness();
    expect(h.connection.capabilities).toEqual(
      expect.arrayContaining([
        "prompt.message",
        "prompt.command",
        "prompt.image",
        "session.configure",
        "session.list",
        "session.persistence",
        "permission",
      ]),
    );
    await h.open();
    expect(h.events).toContainEqual(
      expect.objectContaining({
        type: "session.commands",
        commands: expect.arrayContaining([expect.objectContaining({ name: "compact" })]),
      }),
    );

    const id = await h.message([
      { type: "text", text: "Describe image" },
      { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
    ]);
    await h.completed(id);

    expect(h.events).toContainEqual(
      expect.objectContaining({
        type: "timeline.item",
        item: expect.objectContaining({ type: "assistant_message", text: "ACP_HELLO\n" }),
      }),
    );
    expect(h.events).toContainEqual(
      expect.objectContaining({
        type: "session.usage",
        usage: { inputTokens: 500, outputTokens: 20, cachedInputTokens: 100 },
      }),
    );

    const records = await h.records();
    expect(
      records.some((entry) => entry.args?.includes("acp") && entry.env === "session-overlay"),
    ).toBe(true);
    const newReq = records.find((entry) => entry.rpc?.method === "session/new")?.rpc;
    expect(newReq?.params?._meta).toMatchObject({
      antigravity: { systemPrompt: { append: "SYSTEM PREFIX" } },
    });
    const promptReq = records.find((entry) => entry.rpc?.method === "session/prompt")?.rpc;
    expect(promptReq?.params?.prompt).toEqual([
      { type: "text", text: "Describe image" },
      { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
    ]);

    await h.request({ type: "sessions", requestId: "list-1", cwd: h.cwd });
    expect(h.events.find((event) => event.type === "sessions")).toMatchObject({
      sessions: [
        expect.objectContaining({
          persistence: {
            version: 1,
            data: { sessionId: "b641b567-784e-4580-a4bb-a9d2ef171691" },
          },
          title: "task này đến đâu rồi ?",
        }),
      ],
    });
  });

  it("replays full session history on resume and migrates legacy conversationId + model-effort + full-access", async () => {
    const h = await harness();
    await h.open({
      restored: {
        version: 1,
        data: { conversationId: "b641b567-784e-4580-a4bb-a9d2ef171691" },
      },
      history: "replay",
      config: {
        model: "gemini-4-neon-medium",
        mode: "full-access",
      },
    });

    expect(h.persistence()).toEqual({
      version: 1,
      data: { sessionId: "b641b567-784e-4580-a4bb-a9d2ef171691" },
    });

    const timelineItems = h.events
      .filter(
        (event): event is Extract<ProviderEvent, { type: "timeline.item" }> =>
          event.type === "timeline.item",
      )
      .map((event) => event.item);

    expect(timelineItems).toEqual([
      expect.objectContaining({ type: "user_message", text: "task này đến đâu rồi ?" }),
      expect.objectContaining({ type: "reasoning", text: "Checking repository status." }),
      expect.objectContaining({
        type: "tool_call",
        name: "run_command",
        status: "completed",
        detail: { type: "shell", command: "git status -sb", output: "## main\n", exitCode: 0 },
      }),
      expect.objectContaining({
        type: "assistant_message",
        text: "PR #7 đã merge và đang chạy ổn định.",
      }),
    ]);

    const latestConfig = h.events.findLast((event) => event.type === "session.config");
    expect(latestConfig).toMatchObject({
      type: "session.config",
      config: {
        model: "gemini-4-neon",
        thinkingOption: "medium",
        mode: "full-access",
      },
    });
  });

  it("maps read, write, edit, shell and subagent tool calls into rich Paseo timeline details", async () => {
    const h = await harness();
    await h.open();
    await h.completed(await h.prompt("TOOLS"));

    const tools = h.events
      .filter(
        (event): event is Extract<ProviderEvent, { type: "timeline.item" }> =>
          event.type === "timeline.item" && event.item.type === "tool_call",
      )
      .map((event) => event.item);

    expect(tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "read_file",
          detail: { type: "read", filePath: "/repo/README.md", content: "# README\n" },
        }),
        expect.objectContaining({
          name: "read_file",
          detail: { type: "read", filePath: "/repo/LOC.md", content: "loc" },
        }),
        expect.objectContaining({
          name: "write_to_file",
          detail: { type: "write", filePath: "/repo/notes.md", content: "notes" },
        }),
        expect.objectContaining({
          name: "write_file",
          detail: { type: "write", filePath: "/repo/empty.txt", content: "" },
        }),
        expect.objectContaining({
          name: "multi_replace_file_content",
          detail: {
            type: "edit",
            filePath: "/repo/src/app.ts",
            oldString: "removedLine\n...\noldCode",
            newString: "\n...\nnewCode",
          },
        }),
        expect.objectContaining({
          name: "run_command",
          detail: { type: "shell", command: "printf ACP_SHELL", output: "ACP_SHELL", exitCode: 0 },
        }),
        expect.objectContaining({
          name: "invoke_subagent",
          detail: {
            type: "sub_agent",
            subAgentType: "research",
            description: "Check ACP docs",
            childSessionId: "b6f02329-7415-49a7-a9a9-1cd09e898d26",
            log: "",
          },
        }),
        expect.objectContaining({
          name: "invoke_subagent",
          detail: {
            type: "sub_agent",
            subAgentType: "research",
            description: "Check live output",
            childSessionId: "c7f02329-7415-49a7-a9a9-1cd09e898d99",
            log: "file:///tmp/subagent.log",
          },
        }),
      ]),
    );
  });

  it("surfaces permissions in default mode, auto-approves tool permissions in full-access, and still forwards chooser questions", async () => {
    const h = await harness();
    await h.open({ config: { mode: "default" } });

    const permTurn = await h.prompt("PERMISSION");
    const permEvent = await h.wait((event) => event.type === "session.permission");
    if (permEvent.type !== "session.permission") throw new Error("Expected permission event");
    await h.connection.send({
      type: "session.permission",
      sessionId: "s",
      permissionId: permEvent.request.id,
      response: { behavior: "allow", selectedActionId: "allow" },
    });
    await h.completed(permTurn);
    expect(h.events).toContainEqual(
      expect.objectContaining({
        type: "timeline.item",
        item: expect.objectContaining({ type: "assistant_message", text: "APPROVED" }),
      }),
    );

    // Switch live to full-access: tool permissions auto-approve silently, chooser questions still prompt.
    const eventsBeforeFull = h.events.length;
    await h.request({
      type: "session.configure",
      requestId: "cfg-full",
      sessionId: "s",
      changes: { mode: "full-access" },
    });
    expect(h.events.slice(eventsBeforeFull)).toContainEqual(
      expect.objectContaining({
        type: "session.config",
        config: expect.objectContaining({ mode: "full-access" }),
      }),
    );

    const autoTurn = await h.prompt("PERMISSION");
    await h.completed(autoTurn);
    expect(
      h.events.slice(eventsBeforeFull).filter((event) => event.type === "session.permission"),
    ).toEqual([]);

    const chooserStart = h.events.length;
    const chooserTurn = await h.prompt("CHOOSER");
    const chooserEvent = await h.wait(
      (event) => h.events.indexOf(event) >= chooserStart && event.type === "session.permission",
    );
    if (chooserEvent.type !== "session.permission") throw new Error("Expected chooser permission");
    await h.connection.send({
      type: "session.permission",
      sessionId: "s",
      permissionId: chooserEvent.request.id,
      response: { behavior: "allow", selectedActionId: "option_b" },
    });
    await h.completed(chooserTurn);
    expect(h.events.slice(chooserStart)).toContainEqual(
      expect.objectContaining({
        type: "timeline.item",
        item: expect.objectContaining({ type: "assistant_message", text: "PICKED:option_b" }),
      }),
    );

    // Failed configure preserves full-access state.
    await h.request({
      type: "session.configure",
      requestId: "cfg-bad",
      sessionId: "s",
      changes: { mode: "plan", model: "nonexistent-model" },
    });
    expect(h.events).toContainEqual(
      expect.objectContaining({ type: "request.failed", requestId: "cfg-bad" }),
    );
    const afterBad = h.events.length;
    await h.completed(await h.prompt("PERMISSION"));
    expect(h.events.slice(afterBad).filter((event) => event.type === "session.permission")).toEqual(
      [],
    );

    // Hyphenated allow-once is preferred over allow-always.
    const hyphenStart = h.events.length;
    await h.completed(await h.prompt("PERMISSION_HYPHEN"));
    expect(h.events.slice(hyphenStart)).toContainEqual(
      expect.objectContaining({
        type: "timeline.item",
        item: expect.objectContaining({ type: "assistant_message", text: "SELECTED:allow-once" }),
      }),
    );

    // Duplicate session.open rejection does not strip full-access from the live session.
    await expect(
      h.connection.send({
        type: "session.open",
        requestId: "dup-open",
        sessionId: "s",
        history: "skip",
        config: {
          cwd: h.cwd,
          env: {},
          settings: {},
          mcpServers: {},
          persist: true,
          mode: "full-access",
        },
      }),
    ).rejects.toThrow("Session already exists");
    const afterDup = h.events.length;
    await h.completed(await h.prompt("PERMISSION"));
    expect(h.events.slice(afterDup).filter((event) => event.type === "session.permission")).toEqual(
      [],
    );

    // Leaving full-access for accept-edits restores interactive permission prompts.
    const leaveStart = h.events.length;
    await h.request({
      type: "session.configure",
      requestId: "cfg-accept-edits",
      sessionId: "s",
      changes: { mode: "accept-edits" },
    });
    expect(h.events.slice(leaveStart)).toContainEqual(
      expect.objectContaining({
        type: "session.config",
        config: expect.objectContaining({ mode: "accept-edits" }),
      }),
    );
    const afterLeave = h.events.length;
    const interactiveTurn = await h.prompt("PERMISSION");
    const interactivePerm = await h.wait(
      (event) => h.events.indexOf(event) >= afterLeave && event.type === "session.permission",
    );
    if (interactivePerm.type !== "session.permission") throw new Error("Expected permission event");
    await h.connection.send({
      type: "session.permission",
      sessionId: "s",
      permissionId: interactivePerm.request.id,
      response: { behavior: "allow", selectedActionId: "allow" },
    });
    await h.completed(interactiveTurn);
  });

  it("handles pipelined configures, invalid persistence payloads, and closed-connection sends", async () => {
    const h = await harness();
    await h.open({ config: { mode: "default" } });

    // Pipelined configures: first switches to full-access, second switches back to accept-edits.
    const pipeStart = h.events.length;
    await h.connection.send({
      type: "session.configure",
      requestId: "pipe-1",
      sessionId: "s",
      changes: { mode: "full-access" },
    });
    await h.connection.send({
      type: "session.configure",
      requestId: "pipe-2",
      sessionId: "s",
      changes: { mode: "accept-edits" },
    });
    await h.wait((event) => event.type === "request.completed" && event.requestId === "pipe-2");
    const pipeModes = h.events
      .slice(pipeStart)
      .filter(
        (event): event is Extract<ProviderEvent, { type: "session.config" }> =>
          event.type === "session.config",
      )
      .map((event) => event.config.mode);
    expect(pipeModes).toEqual(["full-access", "accept-edits"]);

    // Malformed persistence on an open connection emits request.failed.
    await h.request({
      type: "session.open",
      requestId: "bad-persist",
      sessionId: "s-bad-persist",
      persistence: { version: 2, data: {} },
      history: "replay",
      config: { cwd: h.cwd, env: {}, settings: {}, mcpServers: {}, persist: true },
    });
    expect(h.events).toContainEqual(
      expect.objectContaining({ type: "request.failed", requestId: "bad-persist" }),
    );

    // Closed connection rejects session.open (even with invalid persistence) and catalog immediately.
    await h.connection.close();
    await expect(
      h.connection.send({
        type: "session.open",
        requestId: "closed-open",
        sessionId: "s-closed",
        persistence: { version: 2, data: {} },
        history: "skip",
        config: { cwd: h.cwd, env: {}, settings: {}, mcpServers: {}, persist: true },
      }),
    ).rejects.toThrow("ACP provider connection is closed");
    await expect(
      h.connection.send({ type: "catalog", requestId: "closed-cat", cwd: h.cwd }),
    ).rejects.toThrow("ACP provider connection is closed");
  });

  it("cancels an in-flight turn cleanly via session/cancel", async () => {
    const h = await harness();
    await h.open();
    const messageId = await h.prompt("HANG");
    await h.wait(
      (event) => event.type === "timeline.item" && event.item.type === "assistant_message",
    );
    await h.request({ type: "session.interrupt", requestId: "stop-1", sessionId: "s" });
    expect(await h.completed(messageId)).toMatchObject({ state: "canceled" });
  });
});

it.runIf(process.platform === "win32")(
  "launches an Antigravity command shim for probes and ACP sessions",
  async () => {
    const h = await harness();
    const shim = path.join(h.cwd, "agy launcher.cmd");
    await writeFile(shim, `@echo off\r\n"${process.execPath}" "${fake}" %*\r\n`);
    h.launch.command = shim;
    h.launch.args = ["--launch-prefix"];
    expect(await provider.status!({ launch: h.launch })).toEqual({ available: true });
    await h.open();
    expect(await h.wait((event) => event.type === "session.opened")).toMatchObject({
      sessionId: "s",
    });
  },
);
