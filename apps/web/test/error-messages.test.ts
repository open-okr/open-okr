import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { OperationError } from "@openokr/core";
import { translate } from "@openokr/ui";
import { CATALOGUES } from "@openokr/ui/catalogues";
import { describe, expect, it } from "vitest";
import { ERROR_MESSAGE_KEYS } from "../lib/error-messages.ts";
import { operationMessage, refusalOf } from "../lib/refusal.ts";

const tIn = (locale: keyof typeof CATALOGUES) => (key: string) =>
  translate(CATALOGUES[locale] ?? {}, key, undefined, {}, locale);

describe("operationMessage", () => {
  it("says a listed domain sentence in the reader's language", () => {
    const error = new OperationError("not_found", "No such goal.");
    expect(operationMessage(error, tIn("ar"))).toBe("لم يتم العثور على هدف.");
    expect(refusalOf(error, tIn("de"))).toBe("Kein Ziel gefunden.");
    expect(operationMessage(error, tIn("en"))).toBe("No such goal.");
  });

  it("keeps an unlisted sentence as the domain wrote it", () => {
    const error = new OperationError("conflict", "12 seats are in use.");
    expect(operationMessage(error, tIn("ar"))).toBe("12 seats are in use.");
  });

  it("keeps the sentence when no translator is at hand", () => {
    const error = new OperationError("not_found", "No such goal.");
    expect(operationMessage(error, undefined)).toBe("No such goal.");
    expect(refusalOf(error)).toBe("No such goal.");
  });

  it("has an English catalogue value equal to each listed sentence", () => {
    for (const [sentence, key] of ERROR_MESSAGE_KEYS) {
      expect(tIn("en")(key)).toBe(sentence);
    }
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "node_modules" ? [] : sources(path);
    }
    return path.endsWith(".ts") && !path.endsWith(".test.ts")
      ? [readFileSync(path, "utf8")]
      : [];
  });
}

describe("the listed sentences", () => {
  it("still occur in packages/core, so a renamed message fails here", () => {
    const core = sources(join(__dirname, "../../../packages/core/src")).join(
      "\n",
    );
    const gone = [...ERROR_MESSAGE_KEYS.keys()].filter(
      (sentence) => !core.includes(JSON.stringify(sentence)),
    );
    expect(gone).toEqual([]);
  });
});
