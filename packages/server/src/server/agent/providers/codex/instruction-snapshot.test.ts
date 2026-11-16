import { describe, expect, it, vi } from "vitest";
import { CodexInstructionSnapshot } from "./instruction-snapshot.js";

describe("CodexInstructionSnapshot on servers without thread/inject_items", () => {
  it("resumes a thread without a receipt when no snapshot is required", async () => {
    const snapshot = new CodexInstructionSnapshot("System prompt", undefined);
    const request = vi.fn();

    await snapshot.apply("thread-1", request, false, false);

    expect(request).not.toHaveBeenCalled();
    expect(snapshot.describe("thread-1")).toBeUndefined();
  });

  it("carries a matching receipt over to a forked thread", async () => {
    const snapshot = new CodexInstructionSnapshot("System prompt", undefined);
    snapshot.recordNewThread("thread-1");
    const request = vi.fn();

    await snapshot.apply("thread-2", request, false, true);

    expect(request).not.toHaveBeenCalled();
    expect(snapshot.describe("thread-2")?.threadId).toBe("thread-2");
  });

  it("rejects when plugin instructions need a snapshot the server cannot inject", async () => {
    const snapshot = new CodexInstructionSnapshot("System prompt", undefined);

    await expect(snapshot.apply("thread-1", vi.fn(), false, true)).rejects.toThrow(
      "Update Codex to 0.121.0 or newer",
    );
  });
});
