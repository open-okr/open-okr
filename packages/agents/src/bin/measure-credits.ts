#!/usr/bin/env node
/**
 * `pnpm ai:measure`: real AI calls, reported in credits (docs/design/ai-credits.md §8).
 *
 *   OPENOKR_AI_API_KEY=... pnpm ai:measure --provider anthropic \
 *     --model claude-haiku-5-5 --model claude-sonnet-5-5
 *
 * Costs real money, usually a few cents a model. Reads no database and writes nothing.
 * `--credit-value` is what one credit is worth, by default one US cent. Exit 2 is a
 * usage error.
 */
import { parseArgs } from "node:util";
import { createAIProvider } from "@openokr/adapters";
import { measureActions } from "../measure.ts";

const { values } = parseArgs({
  options: {
    provider: { type: "string" },
    model: { type: "string", multiple: true },
    "credit-value": { type: "string", default: "0.01" },
  },
});
const apiKey = process.env.OPENOKR_AI_API_KEY ?? "";
const provider = values.provider;
const models = values.model ?? [];
const creditValueUsd = Number(values["credit-value"]);
if (
  (provider !== "anthropic" &&
    provider !== "openai" &&
    provider !== "google") ||
  models.length === 0 ||
  apiKey === "" ||
  !(creditValueUsd > 0)
) {
  process.stderr.write(
    "Usage: OPENOKR_AI_API_KEY=... pnpm ai:measure --provider anthropic|openai|google --model <id> [--model <id>] [--credit-value 0.01]\n",
  );
  process.exit(2);
}

const client = createAIProvider(
  { provider, apiKey },
  {
    policy: {
      contextEgress: "all",
      redactPersonalData: false,
      noTraining: true,
      allowedHosts: [],
    },
  },
);

for (const model of models) {
  const rows = await measureActions({
    provider: client,
    providerKind: provider,
    model,
    creditValueUsd,
  });
  process.stdout.write(`\n${model}\n`);
  for (const row of rows) {
    process.stdout.write(
      `  ${row.credits.toFixed(2).padStart(7)} credits  $${row.costUsd.toFixed(5)}  ${String(row.inputTokens).padStart(6)} in ${String(row.outputTokens).padStart(5)} out  ${row.action}\n`,
    );
  }
  process.stdout.write("\nWhat it said, for you to judge:\n");
  for (const row of rows) {
    process.stdout.write(`\n  ${row.action}\n    ${row.answer}\n`);
  }
}
await client.stop();
