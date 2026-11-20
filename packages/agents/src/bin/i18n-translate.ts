#!/usr/bin/env node
/**
 * `pnpm i18n:translate`: translation command for catalogue files
 * (docs/design/languages.md §6.1, §6.3).
 *
 *   pnpm i18n:translate --mock --locale de
 *   pnpm i18n:translate --estimate --locale ms --keys account.security.sessions
 *   OPENOKR_AI_API_KEY=... pnpm i18n:translate --provider openrouter --model openai/gpt-6-luna --locale ms --keys account.security.sessions
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  type AIProvider,
  createAIProvider,
  MockAIProvider,
} from "@openokr/adapters";
import { findSeededModel } from "@openokr/core";
import { translateCatalogue } from "../i18n-translate.ts";

const { values } = parseArgs({
  options: {
    locale: { type: "string" },
    keys: { type: "string" },
    provider: { type: "string" },
    model: { type: "string" },
    mock: { type: "boolean" },
    estimate: { type: "boolean" },
  },
  allowPositionals: true,
});

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const uiI18nDir = join(repoRoot, "packages/ui/src/i18n");
const messagesDir = join(uiI18nDir, "messages");
const pendingPath = join(uiI18nDir, "pending.json");
const sameAsEnglishPath = join(uiI18nDir, "same-as-english.ts");
const glossaryDir = join(uiI18nDir, "glossary");

const apiKey = process.env.OPENOKR_AI_API_KEY ?? "";
const provider = values.provider;
const model = values.model;
const isMock = values.mock === true;
const isEstimate = values.estimate === true;
const wantsLive = (provider !== undefined || model !== undefined) && !isMock;

if (
  !isMock &&
  !isEstimate &&
  wantsLive &&
  ((provider !== "anthropic" &&
    provider !== "openai" &&
    provider !== "google" &&
    provider !== "openrouter") ||
    model === undefined ||
    apiKey === "")
) {
  process.stderr.write(
    "Usage: pnpm i18n:translate --mock [--locale <code>] [--keys <prefix>]\n" +
      "       pnpm i18n:translate --estimate [--locale <code>] [--keys <prefix>]\n" +
      "       OPENOKR_AI_API_KEY=... pnpm i18n:translate --provider anthropic|openai|google|openrouter --model <id> [--locale <code>] [--keys <prefix>]\n",
  );
  process.exit(2);
}

// Load source catalogue
const sourceCatalogue = JSON.parse(
  await readFile(join(messagesDir, "en.json"), "utf8"),
) as Record<string, string>;
const sourceGlossary = JSON.parse(
  await readFile(join(glossaryDir, "en.json"), "utf8"),
) as Record<string, string>;

async function glossaryFor(locale: string) {
  const path = join(glossaryDir, `${locale}.json`);
  let glossary: Record<string, string> = {};
  try {
    glossary = JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      string
    >;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const missing = Object.keys(sourceGlossary).filter((key) => !glossary[key]);
  return { path, glossary, missing };
}

function estimateTokens(
  keys: readonly string[],
  source: Record<string, string>,
): number {
  return keys.reduce(
    (total, key) => total + Math.ceil((source[key] ?? "").length / 3.5) + 15,
    0,
  );
}

// Load pending ledger
let pendingLedger: Record<string, string[]> = {};
try {
  pendingLedger = JSON.parse(await readFile(pendingPath, "utf8")) as Record<
    string,
    string[]
  >;
} catch {
  pendingLedger = {};
}

// Load same-as-english
let sameAsEnglishAll: Record<string, Record<string, string>> = {};
try {
  const mod = (await import(sameAsEnglishPath)) as {
    SAME_AS_ENGLISH?: Record<string, Record<string, string>>;
  };
  sameAsEnglishAll = mod.SAME_AS_ENGLISH ?? {};
} catch {
  sameAsEnglishAll = {};
}

// Determine target locales
let targetLocales: string[] = [];
if (values.locale) {
  targetLocales = [values.locale];
} else {
  targetLocales = Object.keys(pendingLedger).filter(
    (l) => l !== "en" && (pendingLedger[l]?.length ?? 0) > 0,
  );
}

if (targetLocales.length === 0) {
  process.stdout.write("No locales with pending translations to process.\n");
  process.exit(0);
}

// Seeded rates for estimation and cost tracking
const providerKind =
  provider === "anthropic" ||
  provider === "openai" ||
  provider === "google" ||
  provider === "openrouter"
    ? provider
    : "openrouter";
const modelId = model ?? "openai/gpt-6-luna";
const rates = findSeededModel(providerKind, modelId);
const costInPerMillion = rates?.costInPerMillion ?? 0.1;
const costOutPerMillion = rates?.costOutPerMillion ?? 0.5;

if (isEstimate) {
  for (const loc of targetLocales) {
    let candidateKeys: string[] = [];
    if (values.keys) {
      const pattern = values.keys;
      candidateKeys = Object.keys(sourceCatalogue).filter(
        (k) => k.startsWith(pattern) || k.includes(pattern),
      );
    } else {
      candidateKeys = pendingLedger[loc] ?? [];
    }

    const { missing } = await glossaryFor(loc);
    process.stdout.write(
      `[${loc}] ${missing.length} glossary terms selected.\n`,
    );
    const estimatedInputTokens =
      estimateTokens(candidateKeys, sourceCatalogue) +
      estimateTokens(missing, sourceGlossary);
    const estimatedOutputTokens = estimatedInputTokens;
    const estimatedCostUsd =
      (estimatedInputTokens * costInPerMillion +
        estimatedOutputTokens * costOutPerMillion) /
      1_000_000;

    process.stdout.write(
      `[${loc}] ${candidateKeys.length} keys selected. Estimated ~${estimatedInputTokens} input tokens, ~${estimatedOutputTokens} output tokens, ~$${estimatedCostUsd.toFixed(4)} USD.\n`,
    );
  }
  process.exit(0);
}

let client: AIProvider;
if (isMock) {
  client = new MockAIProvider({
    chatResponse: {
      content: JSON.stringify({
        mock: "Mock translation",
      }),
      usage: { inputTokens: 50, outputTokens: 50 },
    },
  });
} else if (wantsLive && provider) {
  client = createAIProvider(
    {
      provider: provider as "anthropic" | "openai" | "google" | "openrouter",
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
  );
} else {
  // If no provider and not live, display help
  process.stderr.write(
    "Usage: pnpm i18n:translate --mock [--locale <code>] [--keys <prefix>]\n" +
      "       pnpm i18n:translate --estimate [--locale <code>] [--keys <prefix>]\n" +
      "       OPENOKR_AI_API_KEY=... pnpm i18n:translate --provider anthropic|openai|google|openrouter --model <id> [--locale <code>] [--keys <prefix>]\n",
  );
  process.exit(2);
}

let totalSpendUsd = 0;

for (const loc of targetLocales) {
  const targetPath = join(messagesDir, `${loc}.json`);
  let targetCatalogue: Record<string, string> = {};
  try {
    targetCatalogue = JSON.parse(await readFile(targetPath, "utf8")) as Record<
      string,
      string
    >;
  } catch {
    targetCatalogue = {};
  }

  const { path: glossaryPath, glossary, missing } = await glossaryFor(loc);

  let candidateKeys: string[] = [];
  if (values.keys) {
    const pattern = values.keys;
    candidateKeys = Object.keys(sourceCatalogue).filter(
      (k) => k.startsWith(pattern) || k.includes(pattern),
    );
  } else {
    candidateKeys = pendingLedger[loc] ?? [];
  }

  const estimatedInputTokens =
    estimateTokens(candidateKeys, sourceCatalogue) +
    estimateTokens(missing, sourceGlossary);
  const estimatedOutputTokens = estimatedInputTokens;
  const estimatedCostUsd =
    (estimatedInputTokens * costInPerMillion +
      estimatedOutputTokens * costOutPerMillion) /
    1_000_000;

  process.stdout.write(
    `[${loc}] ${candidateKeys.length} keys selected. Estimated ~${estimatedInputTokens} input tokens, ~${estimatedOutputTokens} output tokens, ~$${estimatedCostUsd.toFixed(4)} USD.\n`,
  );

  if (wantsLive && estimatedCostUsd > 1.0) {
    process.stderr.write(
      `Estimated cost ($${estimatedCostUsd.toFixed(4)}) exceeds 1.00 USD spending cap. Aborting.\n`,
    );
    await client.stop();
    process.exit(1);
  }

  if (missing.length > 0) {
    const draft = await translateCatalogue({
      provider: client,
      model: modelId,
      locale: loc,
      keys: missing,
      sourceCatalogue: sourceGlossary,
      targetCatalogue: glossary,
      pendingKeys: missing,
      sameAsEnglish: { kpi: "Method acronym" },
      onProgress: (message) => process.stdout.write(`  glossary: ${message}\n`),
    });
    totalSpendUsd +=
      (draft.inputTokens * costInPerMillion +
        draft.outputTokens * costOutPerMillion) /
      1_000_000;
    if (draft.translatedCount > 0) {
      const orderedGlossary = Object.fromEntries(
        Object.keys(sourceGlossary).flatMap((key) =>
          glossary[key] === undefined ? [] : [[key, glossary[key]]],
        ),
      );
      await writeFile(
        glossaryPath,
        `${JSON.stringify(orderedGlossary, null, 2)}\n`,
      );
    }
    process.stdout.write(
      `  ${loc} glossary: ${draft.translatedCount} translated, ${draft.failedCount} failed (${draft.inputTokens} in, ${draft.outputTokens} out)\n`,
    );
    if (draft.failures.length > 0) {
      for (const failure of draft.failures) {
        process.stdout.write(
          `      FAIL glossary.${failure.key}: ${failure.error}\n`,
        );
      }
      continue;
    }
  }

  if (candidateKeys.length === 0) {
    process.stdout.write(`  ok  ${loc}: 0 keys to translate.\n`);
    continue;
  }

  const result = await translateCatalogue({
    provider: client,
    model: modelId,
    locale: loc,
    keys: candidateKeys,
    sourceCatalogue,
    targetCatalogue,
    pendingKeys: pendingLedger[loc] ?? [],
    sameAsEnglish: sameAsEnglishAll[loc] ?? {},
    glossary,
    onProgress: (msg) => process.stdout.write(`  ${msg}\n`),
  });

  const costUsd =
    (result.inputTokens * costInPerMillion +
      result.outputTokens * costOutPerMillion) /
    1_000_000;
  totalSpendUsd += costUsd;

  // Save target catalogue sorted matching source catalogue order
  const sortedTarget: Record<string, string> = {};
  for (const k of Object.keys(sourceCatalogue)) {
    const val = targetCatalogue[k];
    if (val !== undefined) {
      sortedTarget[k] = val;
    }
  }
  for (const k of Object.keys(targetCatalogue).sort()) {
    const val = targetCatalogue[k];
    if (sortedTarget[k] === undefined && val !== undefined) {
      sortedTarget[k] = val;
    }
  }
  await writeFile(targetPath, `${JSON.stringify(sortedTarget, null, 2)}\n`);

  // Update pending ledger
  pendingLedger[loc] = [...result.remainingPending];
  await writeFile(pendingPath, `${JSON.stringify(pendingLedger, null, 2)}\n`);

  process.stdout.write(
    `  ok  ${loc}: ${result.translatedCount} translated, ${result.failedCount} failed (${result.inputTokens} in, ${result.outputTokens} out, cost: $${costUsd.toFixed(4)} USD)\n`,
  );

  if (result.failedCount > 0) {
    for (const failure of result.failures) {
      process.stdout.write(`      FAIL ${failure.key}: ${failure.error}\n`);
    }
  }
}

process.stdout.write(
  `\nTranslation complete. Total spend: $${totalSpendUsd.toFixed(4)} USD.\n`,
);

await client.stop();
