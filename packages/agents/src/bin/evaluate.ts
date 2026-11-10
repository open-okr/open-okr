#!/usr/bin/env node
/**
 * `pnpm ai:evaluate`: every evaluation set, per capability
 * (docs/design/ai-evaluation.md §8).
 *
 *   pnpm ai:evaluate
 *   OPENOKR_AI_API_KEY=... pnpm ai:evaluate --provider anthropic --model <id>
 *
 * With no provider it runs against the mock: it reads no database, sends
 * nothing anywhere, and exits 1 when a set fails, naming the capability, the
 * fixture and the check. With one it is the live smoke test: each fixture that
 * expects an answer goes to that model, which costs real money, usually a few
 * cents. A live run is for a person to read and is never part of CI. Exit 2 is
 * a usage error.
 */
import { parseArgs } from "node:util";
import { createAIProvider } from "@openokr/adapters";
import { evaluateAll } from "../evaluation/index.ts";

const { values } = parseArgs({
  options: {
    provider: { type: "string" },
    model: { type: "string" },
  },
});

const apiKey = process.env.OPENOKR_AI_API_KEY ?? "";
const provider = values.provider;
const model = values.model;
const wantsLive = provider !== undefined || model !== undefined;

if (
  wantsLive &&
  ((provider !== "anthropic" &&
    provider !== "openai" &&
    provider !== "google") ||
    model === undefined ||
    apiKey === "")
) {
  process.stderr.write(
    "Usage: pnpm ai:evaluate\n" +
      "       OPENOKR_AI_API_KEY=... pnpm ai:evaluate --provider anthropic|openai|google --model <id>\n",
  );
  process.exit(2);
}

const client =
  wantsLive && provider !== undefined
    ? createAIProvider(
        {
          provider: provider as "anthropic" | "openai" | "google",
          apiKey,
        },
        {
          policy: {
            contextEgress: "all",
            redactPersonalData: false,
            noTraining: true,
            allowedHosts: [],
          },
        },
      )
    : undefined;

const reports = await evaluateAll(
  client && model ? { live: { provider: client, model } } : {},
);

process.stdout.write(
  client
    ? `\nThe live smoke test, against ${model}. For you to read, not a gate.\n\n`
    : "\nThe evaluation set, against the mock model.\n\n",
);

let fixtures = 0;
let failing = 0;
for (const report of reports) {
  fixtures += report.fixtures;
  const ok = report.passed === report.fixtures;
  if (!ok) {
    failing += 1;
  }
  const key = report.promptKey === null ? "" : ` (${report.promptKey})`;
  process.stdout.write(
    `  ${ok ? "ok  " : "FAIL"}  ${report.capability}${key}: ${report.passed} of ${report.fixtures}\n`,
  );
  for (const outcome of report.outcomes) {
    if (client) {
      process.stdout.write(
        `          ${String(Math.round(outcome.ms)).padStart(6)} ms  ${String(outcome.inputTokens).padStart(5)} in ${String(outcome.outputTokens).padStart(5)} out  ${outcome.fixture}\n`,
      );
    }
    for (const failure of outcome.failures) {
      process.stdout.write(
        `          ${outcome.fixture}: ${failure.check}, ${failure.detail}\n`,
      );
    }
  }
}

process.stdout.write(
  `\n${reports.length} sets, ${fixtures} fixtures. ` +
    (failing === 0
      ? "Every set passes.\n"
      : `${failing} set${failing === 1 ? "" : "s"} failing.\n`),
);
await client?.stop();
process.exit(failing === 0 ? 0 : 1);
