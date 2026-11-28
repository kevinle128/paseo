// Fake `agy` 1.5.18 CLI + ACP server for deterministic unit tests.
import { appendFileSync } from "node:fs";
import readline from "node:readline";

const args = process.argv.slice(2);
const logFile = process.env.AGY_TEST_LOG;

function record(entry) {
  if (!logFile) return;
  appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
}

record({ args, env: process.env.AGY_SESSION_VALUE ?? null });

const subcommand = args.find((arg) => arg !== "--launch-prefix");

if (subcommand === "--version") {
  process.stdout.write(`${process.env.AGY_TEST_VERSION ?? "1.5.18"}\n`);
  process.exit(0);
}

if (subcommand === "models") {
  if (process.env.AGY_TEST_AUTH === "missing") {
    process.stderr.write("Not logged in. Please run `agy` to sign in.\n");
    process.exit(1);
  }
  const rows = [
    ["gemini-4-neon-low", "Gemini 4 Neon (Low)"],
    ["gemini-4-neon-medium", "Gemini 4 Neon (Medium)"],
    ["gemini-4-neon-high", "Gemini 4 Neon (High)"],
    ["gemini-4-neon-xhigh", "Gemini 4 Neon (XHigh)"],
    ["gemini-3.8-flash-low", "Gemini 3.8 Flash (Low)"],
    ["gemini-3.8-flash-medium", "Gemini 3.8 Flash (Medium)"],
    ["gemini-3.8-flash-high", "Gemini 3.8 Flash (High)"],
    ["claude-sonnet-4-6", "Claude Sonnet 4.6 (Thinking)"],
  ];
  for (const [id, label] of rows) {
    process.stdout.write(`${id}\t${label}\n`);
  }
  process.exit(0);
}

if (subcommand !== "acp") {
  process.stderr.write(`Unexpected agy invocation: ${args.join(" ")}\n`);
  process.exit(2);
}

const MODEL_EFFORTS = {
  "gemini-4-neon": [
    { value: "low", name: "Low" },
    { value: "medium", name: "Medium" },
    { value: "high", name: "High" },
    { value: "xhigh", name: "Extra" },
  ],
  "gemini-3.8-flash": [
    { value: "low", name: "Low" },
    { value: "medium", name: "Medium" },
    { value: "high", name: "High" },
  ],
  "claude-sonnet-4-6": [],
};

const BASE_MODELS = [
  { value: "gemini-4-neon", name: "Gemini 4 Neon" },
  { value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
  { value: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
];

const AVAILABLE_MODES = [
  {
    id: "default",
    name: "Default",
    description: "Ask before edits and commands, per your permission settings.",
  },
  {
    id: "accept-edits",
    name: "Accept edits",
    description: "Approve file edits in the workspace without asking.",
  },
  {
    id: "plan",
    name: "Plan",
    description: "Plan carefully before executing a task.",
  },
];

let model = "gemini-4-neon";
let thoughtLevel = "high";
let currentModeId = "default";
let pendingPermissionId = null;
let pendingPromptRequestId = null;
let nextRpcId = 100;
const pendingServerRequests = new Map();

function buildModes() {
  return { currentModeId, availableModes: AVAILABLE_MODES };
}

function buildConfigOptions() {
  const options = [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: model,
      options: BASE_MODELS,
    },
  ];
  const efforts = MODEL_EFFORTS[model] ?? [];
  if (efforts.length > 0) {
    options.push({
      id: "thought_level",
      name: "Thinking Level",
      category: "thought_level",
      type: "select",
      currentValue: efforts.some((e) => e.value === thoughtLevel) ? thoughtLevel : efforts[0].value,
      options: efforts,
    });
  }
  options.push({
    id: "mode",
    name: "Mode",
    category: "mode",
    type: "select",
    currentValue: currentModeId,
    options: AVAILABLE_MODES.map((entry) => ({
      value: entry.id,
      name: entry.name,
      description: entry.description,
    })),
  });
  return options;
}

function send(payload) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...payload })}\n`);
}

function sendUpdate(sessionId, update) {
  send({ method: "session/update", params: { sessionId, update } });
}

function emitReplayHistory(sessionId) {
  sendUpdate(sessionId, {
    sessionUpdate: "user_message_chunk",
    content: { type: "text", text: "task này đến đâu rồi ?" },
  });
  sendUpdate(sessionId, {
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text: "Checking repository status." },
  });
  sendUpdate(sessionId, {
    sessionUpdate: "tool_call",
    toolCallId: "replay-cmd-1",
    name: "run_command",
    kind: "execute",
    title: "git status -sb",
    status: "completed",
    rawInput: { CommandLine: "git status -sb" },
    rawOutput: { output: "## main\n", exit_code: 0 },
  });
  sendUpdate(sessionId, {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "PR #7 đã merge và đang chạy ổn định." },
  });
}

function askClientPermission(params) {
  const id = nextRpcId++;
  pendingPermissionId = id;
  return new Promise((resolve) => {
    pendingServerRequests.set(id, resolve);
    send({ id, method: "session/request_permission", params });
  });
}

function emitToolSuite(sessionId) {
  const updates = [
    {
      sessionUpdate: "tool_call",
      toolCallId: "tool-read",
      name: "read_file",
      kind: "read",
      title: "File README.md",
      status: "completed",
      locations: [{ path: "/repo/README.md" }],
      rawInput: { Path: "/repo/README.md" },
      rawOutput: "# README\n",
    },
    {
      sessionUpdate: "tool_call",
      toolCallId: "tool-read-loc",
      name: "read_file",
      kind: "read",
      title: "File LOC.md",
      status: "completed",
      locations: [{ path: "/repo/LOC.md" }],
      rawInput: {},
      rawOutput: "loc",
    },
    {
      sessionUpdate: "tool_call",
      toolCallId: "tool-write",
      name: "write_to_file",
      kind: "edit",
      title: "Write notes.md",
      status: "completed",
      locations: [{ path: "/repo/notes.md" }],
      rawInput: { TargetFile: "/repo/notes.md", CodeContent: "notes" },
    },
    {
      sessionUpdate: "tool_call",
      toolCallId: "tool-write-empty",
      name: "write_file",
      kind: "edit",
      title: "Write empty.txt",
      status: "completed",
      locations: [{ path: "/repo/empty.txt" }],
      rawInput: { Content: "" },
    },
    {
      sessionUpdate: "tool_call",
      toolCallId: "tool-write-streaming",
      name: "write_to_file",
      kind: "edit",
      title: "Write streamed.md",
      status: "in_progress",
      rawInput: {},
    },
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-write-streaming",
      status: "completed",
      locations: [{ path: "/repo/streamed.md" }],
      rawInput: { TargetFile: "/repo/streamed.md", CodeContent: "streamed" },
    },
    {
      sessionUpdate: "tool_call",
      toolCallId: "tool-edit",
      name: "multi_replace_file_content",
      kind: "edit",
      title: "Edit src/app.ts",
      status: "completed",
      locations: [{ path: "/repo/src/app.ts" }],
      rawInput: {
        TargetFile: "/repo/src/app.ts",
        ReplacementChunks: [
          { TargetContent: "removedLine", ReplacementContent: "" },
          { TargetContent: "oldCode", ReplacementContent: "newCode" },
        ],
      },
    },
    {
      sessionUpdate: "tool_call",
      toolCallId: "tool-shell",
      name: "run_command",
      kind: "execute",
      title: "printf ACP_SHELL",
      status: "completed",
      rawInput: { CommandLine: "printf ACP_SHELL" },
      rawOutput: { output: "ACP_SHELL", exit_code: 0 },
    },
    {
      sessionUpdate: "tool_call",
      toolCallId: "tool-subagent",
      name: "invoke_subagent",
      kind: "other",
      title: "Subagent research",
      status: "completed",
      rawInput: {
        Subagents: [
          {
            TypeName: "research",
            InitialPrompt: "Check ACP docs",
            ConversationId: "b6f02329-7415-49a7-a9a9-1cd09e898d26",
          },
        ],
      },
    },
    {
      sessionUpdate: "tool_call",
      toolCallId: "tool-subagent-live",
      name: "invoke_subagent",
      kind: "other",
      title: "Subagent live",
      status: "completed",
      rawInput: {
        TypeName: "research",
        Role: "Codebase Researcher",
        Prompt: "Check live output",
      },
      rawOutput: {
        conversationId: "c7f02329-7415-49a7-a9a9-1cd09e898d99",
        logUri: "file:///tmp/subagent.log",
      },
    },
    {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "TOOLS_DONE" },
    },
  ];
  for (const update of updates) sendUpdate(sessionId, update);
}

function handleSetConfigOption(id, params) {
  if (params.configId === "model") {
    const value = String(params.value);
    const decomposed = /^(.*)-(low|medium|high|xhigh|max)$/.exec(value);
    if (BASE_MODELS.some((entry) => entry.value === value)) {
      model = value;
    } else if (decomposed && BASE_MODELS.some((entry) => entry.value === decomposed[1])) {
      model = decomposed[1];
      thoughtLevel = decomposed[2];
    } else {
      send({ id, error: { code: -32602, message: `Unknown Antigravity model: ${value}` } });
      return;
    }
  } else if (params.configId === "thought_level") {
    const efforts = MODEL_EFFORTS[model] ?? [];
    if (!efforts.some((entry) => entry.value === params.value)) {
      send({
        id,
        error: { code: -32602, message: `Unsupported thinking level: ${params.value}` },
      });
      return;
    }
    thoughtLevel = String(params.value);
  } else if (params.configId === "mode") {
    if (!AVAILABLE_MODES.some((entry) => entry.id === params.value)) {
      send({ id, error: { code: -32602, message: `Unknown mode: ${params.value}` } });
      return;
    }
    currentModeId = String(params.value);
  } else {
    send({ id, error: { code: -32602, message: `Unknown config option: ${params.configId}` } });
    return;
  }
  const updated = buildConfigOptions();
  sendUpdate(params.sessionId, {
    sessionUpdate: "config_option_update",
    configOptions: updated,
  });
  send({ id, result: { configOptions: updated } });
}

async function handlePrompt(id, params) {
  const sessionId = params.sessionId;
  const text = params.prompt.find((part) => part.type === "text")?.text ?? "";
  if (text === "TOOLS") {
    emitToolSuite(sessionId);
    send({
      id,
      result: {
        stopReason: "end_turn",
        usage: { inputTokens: 1200, outputTokens: 80, cachedReadTokens: 400 },
      },
    });
    return;
  }
  if (text === "PERMISSION") {
    pendingPromptRequestId = id;
    const perm = await askClientPermission({
      sessionId,
      toolCall: {
        toolCallId: "perm-shell-1",
        name: "run_command",
        kind: "execute",
        title: "echo SECRET_CHECK",
        rawInput: { CommandLine: "echo SECRET_CHECK" },
      },
      options: [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "deny", name: "Deny", kind: "reject_once" },
      ],
    });
    pendingPromptRequestId = null;
    const allowed = perm?.outcome?.outcome === "selected" && perm.outcome.optionId === "allow";
    sendUpdate(sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: allowed ? "APPROVED" : "DENIED" },
    });
    send({ id, result: { stopReason: "end_turn" } });
    return;
  }
  if (text === "PERMISSION_HYPHEN") {
    pendingPromptRequestId = id;
    const perm = await askClientPermission({
      sessionId,
      toolCall: {
        toolCallId: "perm-shell-hyphen",
        name: "run_command",
        kind: "execute",
        title: "echo HYPHEN_CHECK",
        rawInput: { CommandLine: "echo HYPHEN_CHECK" },
      },
      options: [
        { optionId: "allow-always", name: "Allow always", kind: "allow_always" },
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "reject-once", name: "Deny", kind: "reject_once" },
      ],
    });
    pendingPromptRequestId = null;
    const selected = perm?.outcome?.outcome === "selected" ? perm.outcome.optionId : "cancelled";
    sendUpdate(sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `SELECTED:${selected}` },
    });
    send({ id, result: { stopReason: "end_turn" } });
    return;
  }
  if (text === "CHOOSER") {
    pendingPromptRequestId = id;
    const choice = await askClientPermission({
      sessionId,
      toolCall: {
        toolCallId: "chooser-1",
        name: "ask_question",
        kind: "other",
        title: "Pick approach",
        rawInput: { question: "Which approach?" },
      },
      options: [
        { optionId: "option_a", name: "Option A", kind: "allow_once" },
        { optionId: "option_b", name: "Option B", kind: "allow_once" },
      ],
    });
    pendingPromptRequestId = null;
    const picked = choice?.outcome?.outcome === "selected" ? choice.outcome.optionId : "cancelled";
    sendUpdate(sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `PICKED:${picked}` },
    });
    send({ id, result: { stopReason: "end_turn" } });
    return;
  }
  if (text === "HANG") {
    pendingPromptRequestId = id;
    sendUpdate(sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "WORKING..." },
    });
    return;
  }
  sendUpdate(sessionId, {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "ACP_HELLO\n" },
  });
  send({
    id,
    result: {
      stopReason: "end_turn",
      usage: { inputTokens: 500, outputTokens: 20, cachedReadTokens: 100 },
    },
  });
}

function handleCancel(id) {
  if (pendingPermissionId !== null) {
    const resolver = pendingServerRequests.get(pendingPermissionId);
    pendingServerRequests.delete(pendingPermissionId);
    pendingPermissionId = null;
    resolver?.({ outcome: { outcome: "cancelled" } });
  }
  if (pendingPromptRequestId !== null) {
    const promptId = pendingPromptRequestId;
    pendingPromptRequestId = null;
    send({ id: promptId, result: { stopReason: "cancelled" } });
  }
  send({ id, result: {} });
}

async function handleRequest(id, method, params) {
  if (method === "initialize") {
    if (process.env.AGY_TEST_STARTUP === "fail") {
      send({ id, error: { code: -32603, message: "Antigravity ACP startup failed" } });
      return;
    }
    send({
      id,
      result: {
        protocolVersion: params.protocolVersion ?? 1,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: true, audio: false, embeddedContext: true },
          sessionCapabilities: { resume: {}, close: {}, load: {}, list: {} },
          _meta: { antigravity: { tier: true, systemPrompt: { append: true } } },
        },
        agentInfo: { name: "Antigravity ACP Server", version: "1.5.18" },
      },
    });
    return;
  }
  if (method === "session/list") {
    send({
      id,
      result: {
        sessions: [
          {
            sessionId: "b641b567-784e-4580-a4bb-a9d2ef171691",
            cwd: params?.cwd ?? "/repo",
            title: "task này đến đâu rồi ?",
            updatedAt: "2026-11-27T07:38:30Z",
          },
        ],
      },
    });
    return;
  }
  if (method === "session/new" || method === "session/load") {
    const sessionId =
      method === "session/load" ? params.sessionId : "e5cf1e2d-c715-4328-8e67-4a85c8dc3cda";
    if (method === "session/load") emitReplayHistory(sessionId);
    send({ id, result: { sessionId, modes: buildModes(), configOptions: buildConfigOptions() } });
    sendUpdate(sessionId, {
      sessionUpdate: "available_commands_update",
      availableCommands: [
        { name: "compact", description: "Compact the conversation now." },
        { name: "plan", description: "Plan carefully before executing a task." },
      ],
    });
    return;
  }
  if (method === "session/set_mode") {
    if (!AVAILABLE_MODES.some((entry) => entry.id === params.modeId)) {
      send({ id, error: { code: -32602, message: `Unknown Antigravity mode: ${params.modeId}` } });
      return;
    }
    currentModeId = params.modeId;
    send({ id, result: {} });
    return;
  }
  if (method === "session/set_config_option") {
    handleSetConfigOption(id, params);
    return;
  }
  if (method === "session/prompt") {
    await handlePrompt(id, params);
    return;
  }
  if (method === "session/cancel") {
    handleCancel(id);
    return;
  }
  if (method === "session/close") {
    send({ id, result: {} });
  }
}

readline.createInterface({ input: process.stdin }).on("line", async (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  record({ rpc: message });
  if (!("method" in message) && "id" in message) {
    const resolver = pendingServerRequests.get(message.id);
    if (resolver) {
      pendingServerRequests.delete(message.id);
      pendingPermissionId = null;
      resolver(message.result);
    }
    return;
  }
  await handleRequest(message.id, message.method, message.params);
});
