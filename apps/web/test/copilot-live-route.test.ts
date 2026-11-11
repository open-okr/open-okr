import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Rejoining a copilot run hears what the asking request would have
 * (plan 0.8.1 CP3, review F21). A card made while a reader was away showed
 * only once the answer finished; the live route now forwards it as it is
 * made, as the POST does.
 */
const route = readFileSync(
  fileURLToPath(new URL("../app/api/copilot/live/route.ts", import.meta.url)),
  "utf8",
);

describe("the copilot's live route", () => {
  test("forwards a card, as the asking request does", () => {
    expect(route).toContain('event.name === "copilot.proposal"');
    expect(route).toContain('send("proposal"');
  });
});
