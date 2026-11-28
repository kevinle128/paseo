import type { AcpTransformer } from "@getpaseo/plugin/server/acp";
import type {
  ProviderTimelineItem,
  ProviderToolCallDetail,
} from "@getpaseo/plugin/server/provider";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
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

function extractReplacementPair(input: Record<string, unknown> | null): {
  oldString: string | null;
  newString: string | null;
} {
  const directOld = pickString(input, [
    "oldString",
    "Target",
    "target",
    "TargetContent",
    "targetContent",
  ]);
  const directNew = pickString(input, [
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
    const oldPart = pickString(chunk, ["TargetContent", "targetContent"]);
    const newPart = pickString(chunk, ["ReplacementContent", "replacementContent"]);
    if (oldPart !== undefined) oldParts.push(oldPart);
    if (newPart !== undefined) newParts.push(newPart);
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
  toolCall(toolCall) {
    const input = asRecord(toolCall.input);
    const filePath = pickString(input, FILE_PATH_KEYS) ?? toolCall.locations[0];
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

function mapSubagentDetail(input: Record<string, unknown> | null): ProviderToolCallDetail {
  const list = input?.Subagents ?? input?.subagents;
  const first = Array.isArray(list) && list.length > 0 ? asRecord(list[0]) : input;
  const subAgentType = pickString(first, ["TypeName", "typeName", "type_name"]);
  const description = pickString(first, [
    "Prompt",
    "prompt",
    "InitialPrompt",
    "initial_prompt",
    "Role",
    "role",
  ]);
  const childSessionId = pickString(first, ["ConversationId", "conversation_id"]);
  return { type: "sub_agent", subAgentType, description, childSessionId, log: "" };
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
    const content = pickString(input, ["Content", "content", "CodeContent", "codeContent"]);
    return { type: "write", filePath, content };
  }
  if (name === "invoke_subagent") {
    return mapSubagentDetail(input);
  }
  return null;
}
