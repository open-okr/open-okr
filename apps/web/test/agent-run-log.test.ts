import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AGENT_RUN_LOG_CODES } from "@openokr/db";
import { type MessageValues, translate } from "@openokr/ui";
import { CATALOGUES } from "@openokr/ui/catalogues";
import { describe, expect, it } from "vitest";
import { RUN_LOG_SENTENCE_KEYS, runLogText } from "../lib/agent-run-log.ts";

/**
 * A run's log in the reader's language (docs/design/agent-run-log-language.md
 * §7). The executor stores a code and its values beside the English sentence;
 * the admin screen renders the code, and an entry with no code as stored.
 */
const tIn =
  (locale: keyof typeof CATALOGUES) => (key: string, values?: MessageValues) =>
    translate(CATALOGUES[locale] ?? CATALOGUES.en, key, values);

const at = "2026-11-23T09:00:00.000Z";

describe("the agent run log", () => {
  it("reads a sandbox line in Arabic, with the action name as written", () => {
    const text = runLogText(
      {
        message: 'Simulated "goals.update" — sandbox mode commits nothing.',
        code: "simulated",
        values: { action: "goals.update" },
      },
      tIn("ar"),
    );
    expect(text).toContain("goals.update");
    expect(text).toMatch(/[؀-ۿ]/);
    expect(text).not.toContain("sandbox mode");
  });

  it("shows a line stored before codes existed as its English sentence", () => {
    const stored = {
      at,
      taskIndex: 0,
      kind: "proposed",
      message: "Proposed x.",
    };
    expect(runLogText(stored, tIn("id"))).toBe("Proposed x.");
  });

  it("shows a code this release does not know as its stored sentence", () => {
    expect(
      runLogText({ message: "Later.", code: "fromTheFuture" }, tIn("id")),
    ).toBe("Later.");
  });

  it("puts the refusal from the error map inside the translated failure", () => {
    const text = runLogText(
      {
        message: '"goals.update" failed: No such goal.',
        code: "failed",
        values: { action: "goals.update", error: "No such goal." },
      },
      tIn("id"),
    );
    expect(text).toContain("goals.update");
    expect(text).toContain(tIn("id")("error.noSuchGoal"));
    expect(text).not.toContain("No such goal.");
  });

  it("keeps a refusal nobody translated as it was written", () => {
    const text = runLogText(
      {
        message: '"goals.update" failed: Something rare.',
        code: "failed",
        values: { action: "goals.update", error: "Something rare." },
      },
      tIn("de"),
    );
    expect(text).toContain("Something rare.");
  });

  it("says the executor's own denial in the reader's language", () => {
    const text = runLogText(
      {
        message:
          'Denied "spaces.update": No such resource, or this agent has no access to it.',
        code: "denied",
        values: {
          action: "spaces.update",
          why: "No such resource, or this agent has no access to it.",
        },
      },
      tIn("id"),
    );
    expect(text).toContain(tIn("id")("agents.runLog.reason.noAccess"));
  });

  it("reads in English exactly as the sentences the executor stores", () => {
    const en = tIn("en");
    expect(
      runLogText(
        {
          message: 'Proposed "goals.update" for review.',
          code: "proposed",
          values: { action: "goals.update" },
        },
        en,
      ),
    ).toBe('Proposed "goals.update" for review.');
    expect(
      runLogText(
        {
          message: "Stopped: this agent was turned off.",
          code: "agentDisabled",
        },
        en,
      ),
    ).toBe("Stopped: this agent was turned off.");
  });

  it("has a catalogue key for every code", () => {
    for (const code of AGENT_RUN_LOG_CODES) {
      expect(CATALOGUES.en[`agents.runLog.${code}`], code).toBeTypeOf("string");
    }
  });

  it("names only sentences the executor still writes", () => {
    const executor = readFileSync(
      fileURLToPath(
        new URL(
          "../../../packages/agents/src/run-executor.ts",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    for (const [sentence, key] of RUN_LOG_SENTENCE_KEYS) {
      expect(executor, sentence).toContain(sentence);
      // English is the sentence itself, so an English reader sees no change.
      expect(CATALOGUES.en[key], key).toBe(sentence);
    }
  });
});
