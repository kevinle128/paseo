import { describe, expect, it } from "vitest";
import { resolveFocusAfterCellRemoval } from "./focus-after-removal";

const a = { serverId: "s1", workspaceId: "a" };
const b = { serverId: "s2", workspaceId: "b" };
const c = { serverId: "s1", workspaceId: "c" };
const d = { serverId: "s1", workspaceId: "d" };

describe("resolveFocusAfterCellRemoval", () => {
  it.each([
    ["a middle cell goes to the cell after it", [a, b, c], [a, c], b, c],
    ["the last cell goes to the cell before it", [a, b, c], [a, b], c, b],
    ["the first cell goes to the cell after it", [a, b, c], [b, c], a, b],
    ["the only cell leaves no neighbor", [a], [], a, null],
    ["an active cell that stays is not affected", [a, b, c], [a, c], a, null],
    ["an active workspace that was not a cell is not affected", [a, b], [a], c, null],
    ["no active workspace is not affected", [a, b], [a], null, null],
    ["several removed cells go to the nearest remaining one after", [a, b, c, d], [a, d], b, d],
    ["removing the active cell and those after it goes backwards", [a, b, c, d], [a], b, a],
    [
      "removing the last cells goes to the nearest remaining one before",
      [a, b, c, d],
      [a, b],
      d,
      b,
    ],
    ["the host is part of the identity", [a, b], [a], { serverId: "s2", workspaceId: "a" }, null],
  ])("%s", (_name, previousCells, nextCells, activeSelection, expected) => {
    expect(resolveFocusAfterCellRemoval({ previousCells, nextCells, activeSelection })).toEqual(
      expected,
    );
  });

  it("returns the element of the next cells", () => {
    const nextC = { ...c };
    expect(
      resolveFocusAfterCellRemoval({
        previousCells: [a, b, c],
        nextCells: [a, nextC],
        activeSelection: b,
      }),
    ).toBe(nextC);
  });
});
