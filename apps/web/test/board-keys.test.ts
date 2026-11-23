import { describe, expect, test } from "vitest";
import { stepTarget } from "../app/board/board-keys.ts";

const columns = [
  { status: "todo", cards: [{ id: "first", status: "todo" }] },
  { status: "doing", cards: [{ id: "second", status: "doing" }] },
];

describe("moving a card in reading order (languages AC-16)", () => {
  test("ArrowLeft carries the first card into the second column in RTL", () => {
    expect(stepTarget(columns, "first", "ArrowLeft", "rtl")).toEqual({
      status: "doing",
      index: 0,
    });
    expect(stepTarget(columns, "first", "ArrowRight", "rtl")).toBeNull();
    expect(stepTarget(columns, "second", "ArrowRight", "rtl")).toEqual({
      status: "todo",
      index: 0,
    });
  });

  test("ArrowRight still carries the first card into the second column in LTR", () => {
    expect(stepTarget(columns, "first", "ArrowRight", "ltr")).toEqual({
      status: "doing",
      index: 0,
    });
  });
});
