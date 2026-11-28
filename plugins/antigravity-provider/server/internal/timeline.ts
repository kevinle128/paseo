import type { AcpToolCallSnapshot, AcpTransformer } from "@getpaseo/plugin/server/acp";
import type {
  ProviderTimelineItem,
  ProviderToolCallDetail,
} from "@getpaseo/plugin/server/provider";

type JsonRecord = Record<string, AcpToolCallSnapshot["input"]>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asJsonRecord(value: AcpToolCallSnapshot["input"]): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function pickString(
  record: Record<string, unknown> | null,
  keys: readonly string[],
): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function pickText(
  record: Record<string, unknown> | null,
  keys: readonly string[],
): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function extractReplacementPair(input: Record<string, unknown> | null): {
  oldString: string | null;
  newString: string | null;
} {
  const directOld = pickText(input, [
    "oldString",
    "Target",
    "target",
    "TargetContent",
    "targetContent",
  ]);
  const directNew = pickText(input, [
    "newString",
    "Replacement",
    "replacement",
    "ReplacementContent",
    "replacementContent",
  ]);
  if (directOld !== undefined || directNew !== undefined) {
    return { oldString: directOld ?? null, newString: directNew ?? null };
  }
  const chunks = input?.ReplacementChunks ?? input?.replacementChunks;
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return { oldString: null, newString: null };
  }
  const oldParts: string[] = [];
  const newParts: string[] = [];
  for (const entry of chunks) {
    const chunk = asRecord(entry);
    const oldPart = pickText(chunk, ["TargetContent", "targetContent"]);
    const newPart = pickText(chunk, ["ReplacementContent", "replacementContent"]);
    if (oldPart !== undefined || newPart !== undefined) {
      oldParts.push(oldPart ?? "");
      newParts.push(newPart ?? "");
    }
  }
  return {
    oldString: oldParts.length > 0 ? oldParts.join("\n...\n") : null,
    newString: newParts.length > 0 ? newParts.join("\n...\n") : null,
  };
}

const FILE_PATH_KEYS = [
  "filePath",
  "Path",
  "path",
  "TargetFile",
  "targetFile",
  "AbsolutePath",
  "absolutePath",
] as const;

export const antigravityAcpTransformer: AcpTransformer = {
  sessionMeta(config) {
    return config.systemPrompt
      ? { antigravity: { systemPrompt: { append: config.systemPrompt } } }
      : undefined;
  },
  toolCall(toolCall): AcpToolCallSnapshot {
    const input = asJsonRecord(toolCall.input);
    const filePath = pickString(input, FILE_PATH_KEYS) ?? toolCall.locations[0];
    if (toolCall.name === "write_file" || toolCall.name === "write_to_file") {
      return {
        ...toolCall,
        kind: "other",
        ...(filePath ? { input: { ...input, filePath } } : {}),
      };
    }
    if (!filePath) return toolCall;
    if (
      toolCall.name === "edit_file" ||
      toolCall.name === "replace_file_content" ||
      toolCall.name === "multi_replace_file_content"
    ) {
      const { oldString, newString } = extractReplacementPair(input);
      return {
        ...toolCall,
        kind: "edit",
        input: { filePath, oldString, newString },
      };
    }
    if (toolCall.name === "read_file" || toolCall.name === "view_file") {
      return {
        ...toolCall,
        input: { ...input, filePath },
      };
    }
    return toolCall;
  },
};

export function mapAntigravityTimelineItem(item: ProviderTimelineItem): ProviderTimelineItem {
  if (item.type !== "tool_call" || item.detail.type !== "unknown") return item;
  const detail = mapUnknownToolDetail(item.name, item.detail.input, item.detail.output);
  return detail ? { ...item, detail } : item;
}

function extractShellOutput(
  rawOutput: unknown,
  outputRecord: Record<string, unknown> | null,
): string | undefined {
  if (typeof rawOutput === "string") return rawOutput;
  if (typeof outputRecord?.output === "string") return outputRecord.output;
  return undefined;
}

function firstSubagentRecord(
  record: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const list = record?.Subagents ?? record?.subagents;
  return Array.isArray(list) && list.length > 0 ? asRecord(list[0]) : record;
}

function mapSubagentDetail(
  input: Record<string, unknown> | null,
  outputRecord: Record<string, unknown> | null,
): ProviderToolCallDetail {
  const firstInput = firstSubagentRecord(input);
  const firstOutput = firstSubagentRecord(outputRecord);
  const subAgentType =
    pickString(firstInput, ["TypeName", "typeName", "type_name"]) ??
    pickString(firstOutput, ["TypeName", "typeName", "type_name"]);
  const description =
    pickString(firstInput, [
      "Prompt",
      "prompt",
      "InitialPrompt",
      "initial_prompt",
      "Role",
      "role",
    ]) ??
    pickString(firstOutput, [
      "Prompt",
      "prompt",
      "InitialPrompt",
      "initial_prompt",
      "Role",
      "role",
    ]);
  const childSessionId =
    pickString(firstOutput, ["ConversationId", "conversationId", "conversation_id"]) ??
    pickString(outputRecord, ["ConversationId", "conversationId", "conversation_id"]) ??
    pickString(firstInput, ["ConversationId", "conversationId", "conversation_id"]);
  const log =
    pickString(firstOutput, ["log_uri", "logUri", "log"]) ??
    pickString(outputRecord, ["log_uri", "logUri", "log"]) ??
    pickString(firstInput, ["log_uri", "logUri", "log"]) ??
    "";
  return { type: "sub_agent", subAgentType, description, childSessionId, log };
}

function mapUnknownToolDetail(
  name: string,
  rawInput: unknown,
  rawOutput: unknown,
): ProviderToolCallDetail | null {
  const input = asRecord(rawInput);
  const outputRecord = asRecord(rawOutput);
  if (name === "run_command") {
    const command = pickString(input, ["CommandLine", "commandLine", "command"]);
    if (!command) return null;
    const output = extractShellOutput(rawOutput, outputRecord);
    const exitCode =
      typeof outputRecord?.exit_code === "number" ? outputRecord.exit_code : undefined;
    return { type: "shell", command, output, exitCode };
  }
  if (name === "read_file" || name === "view_file") {
    const filePath = pickString(input, FILE_PATH_KEYS);
    if (!filePath) return null;
    const content = typeof rawOutput === "string" ? rawOutput : undefined;
    return { type: "read", filePath, content };
  }
  if (name === "write_file" || name === "write_to_file") {
    const filePath = pickString(input, FILE_PATH_KEYS);
    if (!filePath) return null;
    const content = pickText(input, ["Content", "content", "CodeContent", "codeContent"]);
    return { type: "write", filePath, content };
  }
  if (name === "invoke_subagent") {
    return mapSubagentDetail(input, outputRecord);
  }
  return null;
}
