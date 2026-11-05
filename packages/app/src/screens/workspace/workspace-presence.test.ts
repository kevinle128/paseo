import { describe, expect, it } from "vitest";
import {
  isPresented,
  ownsInput,
  singlePresence,
  type WorkspacePresence,
} from "./workspace-presence";

describe("workspace presence", () => {
  it("maps the single-workspace active flag to focused or hidden", () => {
    expect(singlePresence(true)).toBe("focused");
    expect(singlePresence(false)).toBe("hidden");
  });

  it.each<[WorkspacePresence, boolean, boolean]>([
    ["focused", true, true],
    ["reduced", true, false],
    ["hidden", false, false],
  ])("%s: presented=%s ownsInput=%s", (presence, presented, input) => {
    expect(isPresented(presence)).toBe(presented);
    expect(ownsInput(presence)).toBe(input);
  });
});
