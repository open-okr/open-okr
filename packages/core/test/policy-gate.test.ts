import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The policy gate (P9-T02, design §2.2, robustness rule R1).
 *
 * **Why a source test.** The drafting lock P9-T02 removed was added to one
 * action, behind a flag only the cycle screen set, so the API, the command
 * line and the copilot never met it (completeness review H-09). A rule about
 * practice that lives in one caller is a rule the other callers skip. So every
 * action that creates, changes, publishes or closes an OKR must either ask the
 * one policy, through `requirePolicy`, or say in a comment beside it why it
 * need not:
 *
 *     // openokr:policy-exempt: <the reason, in a sentence>
 *
 * The OKR actions are every write in an `actions/goal*.ts` file, plus
 * `workflow.publish`. Check-ins, dependencies and comments are other
 * aggregates with their own rules, and are not practice choices.
 */

const ACTIONS = join(dirname(fileURLToPath(import.meta.url)), "../src/actions");

interface ActionBlock {
  readonly file: string;
  readonly name: string;
  readonly kind: "read" | "write";
  readonly source: string;
}

/** Every action declared in a file, with the source of its declaration. */
function actionBlocks(file: string): ActionBlock[] {
  const source = readFileSync(join(ACTIONS, file), "utf8");
  const starts = [...source.matchAll(/define(Read|Write)Action\(\{/g)];
  return starts.map((match, index) => {
    const start = match.index ?? 0;
    const end = starts[index + 1]?.index ?? source.length;
    const block = source.slice(start, end);
    return {
      file,
      name: /name: "([^"]+)"/.exec(block)?.[1] ?? "(unnamed)",
      kind: match[1] === "Write" ? "write" : "read",
      source: block,
    };
  });
}

const okrFiles = readdirSync(ACTIONS).filter((file) =>
  /^goals?(-[a-z-]+)?\.ts$/.test(file),
);

const governed: ActionBlock[] = [
  ...okrFiles.flatMap(actionBlocks).filter((block) => block.kind === "write"),
  ...actionBlocks("cycle-workflow.ts").filter(
    (block) => block.name === "workflow.publish",
  ),
];

const EXEMPTION = /openokr:policy-exempt: (.+)/;

describe("every OKR write asks the policy or says why not", () => {
  it("finds the OKR writes, so a parse that finds nothing cannot pass", () => {
    const names = governed.map((block) => block.name);
    expect(names).toContain("goals.create");
    expect(names).toContain("goals.addKeyResult");
    expect(names).toContain("workflow.publish");
    expect(governed.length).toBeGreaterThan(10);
  });

  for (const block of governed) {
    it(`${block.name} (${block.file})`, () => {
      const asks = block.source.includes("requirePolicy(");
      const exemption = EXEMPTION.exec(block.source)?.[1] ?? "";
      expect(
        asks || exemption.trim().length >= 30,
        `${block.name} neither calls requirePolicy nor carries an "openokr:policy-exempt:" reason of a sentence`,
      ).toBe(true);
    });
  }

  it("asks the policy where METHOD.md §2.9 says writing may wait", () => {
    for (const name of ["goals.create", "goals.addKeyResult"]) {
      const block = governed.find((entry) => entry.name === name);
      expect(block?.source, name).toContain("requirePolicy(");
    }
  });
});
