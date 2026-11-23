#!/usr/bin/env node
/**
 * `pnpm i18n:translate`: translation command for catalogue files
 * (docs/design/languages.md §6.1, §6.3).
 *
 *   pnpm i18n:translate --mock --locale de
 *   pnpm i18n:translate --estimate --locale ms --keys account.security.sessions
 *   OPENOKR_AI_API_KEY=... pnpm i18n:translate --provider openrouter --model <id> --locale ms --concurrency 6
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
import {
  catalogueWithLocalePlurals,
  findSeededModel,
  messageHasLetters,
} from "@openokr/core";
import { translateCatalogue } from "../i18n-translate.ts";

const { values } = parseArgs({
  options: {
    locale: { type: "string" },
    keys: { type: "string" },
    provider: { type: "string" },
    model: { type: "string" },
    mock: { type: "boolean" },
    estimate: { type: "boolean" },
    concurrency: { type: "string" },
  },
  allowPositionals: true,
});

let concurrency: number | undefined;
if (values.concurrency !== undefined) {
  if (!/^[1-9][0-9]*$/.test(values.concurrency)) {
    process.stderr.write("--concurrency must be a positive integer.\n");
    process.exit(2);
  }
  concurrency = Number(values.concurrency);
}

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const uiI18nDir = join(repoRoot, "packages/ui/src/i18n");
const messagesDir = join(uiI18nDir, "messages");
const serverMessagesDir = join(repoRoot, "packages/core/src/i18n/messages");
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
      "       OPENOKR_AI_API_KEY=... pnpm i18n:translate --provider anthropic|openai|google|openrouter --model <id> [--locale <code>] [--keys <prefix>] [--concurrency <n>]\n",
  );
  process.exit(2);
}

type Messages = Record<string, string>;
type EnglishExceptions = Record<string, Record<string, string>>;

async function readMessages(path: string, optional = false): Promise<Messages> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Messages;
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT")
      return {};
    throw error;
  }
}

const [sourceCatalogue, sourceServerCatalogue, sourceGlossary] =
  await Promise.all([
    readMessages(join(messagesDir, "en.json")),
    readMessages(join(serverMessagesDir, "en.json")),
    readMessages(join(glossaryDir, "en.json")),
  ]);

async function glossaryFor(locale: string) {
  const path = join(glossaryDir, `${locale}.json`);
  const glossary = await readMessages(path, true);
  const missing = Object.keys(sourceGlossary).filter((key) => !glossary[key]);
  return { path, glossary, missing };
}

function estimateTokens(keys: readonly string[], source: Messages): number {
  return keys.reduce(
    (total, key) => total + Math.ceil((source[key] ?? "").length / 3.5) + 15,
    0,
  );
}

async function writeMessages(
  path: string,
  source: Messages,
  target: Messages,
): Promise<void> {
  const keys = new Set([...Object.keys(source), ...Object.keys(target).sort()]);
  const sorted = Object.fromEntries(
    [...keys].flatMap((key) =>
      target[key] === undefined ? [] : [[key, target[key]]],
    ),
  );
  await writeFile(path, `${JSON.stringify(sorted, null, 2)}\n`);
}

let pendingLedger: Record<string, string[]> = {};
try {
  pendingLedger = JSON.parse(await readFile(pendingPath, "utf8")) as Record<
    string,
    string[]
  >;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const { SAME_AS_ENGLISH, SERVER_SAME_AS_ENGLISH } = (await import(
  sameAsEnglishPath
)) as {
  SAME_AS_ENGLISH: EnglishExceptions;
  SERVER_SAME_AS_ENGLISH: EnglishExceptions;
};

const catalogues = [
  {
    dir: messagesDir,
    kind: "UI",
    source: sourceCatalogue,
    exceptions: SAME_AS_ENGLISH,
  },
  {
    dir: serverMessagesDir,
    kind: "server",
    source: sourceServerCatalogue,
    exceptions: SERVER_SAME_AS_ENGLISH,
  },
] as const;

async function prepareLocale(locale: string) {
  const jobs = await Promise.all(
    catalogues.map(async ({ dir, kind, source, exceptions }) => {
      const path = join(dir, `${locale}.json`);
      const stored = await readMessages(path, true);
      const sameAsEnglish = exceptions[locale] ?? {};
      const translatedSource = catalogueWithLocalePlurals(source, locale);
      const pending = new Set(
        kind === "UI" ? (pendingLedger[locale] ?? []) : [],
      );
      const keys: string[] = [];
      const target = { ...stored };
      for (const [key, english] of Object.entries(translatedSource)) {
        if (sameAsEnglish[key] || !messageHasLetters(english)) {
          target[key] ??= english;
          pending.delete(key);
          continue;
        }
        const missing = target[key] === undefined || target[key] === english;
        if (
          values.keys ? key.includes(values.keys) : missing || pending.has(key)
        ) {
          keys.push(key);
          if (kind === "UI" && missing) {
            target[key] ??= english;
            pending.add(key);
          }
        }
      }
      return {
        path,
        kind,
        source: translatedSource,
        stored,
        target,
        sameAsEnglish,
        pending,
        keys,
      };
    }),
  );
  const glossary = await glossaryFor(locale);
  const tokens =
    estimateTokens(glossary.missing, sourceGlossary) +
    jobs.reduce((sum, job) => sum + estimateTokens(job.keys, job.source), 0);
  return { jobs, glossary, tokens };
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

function logEstimate(
  locale: string,
  plan: Awaited<ReturnType<typeof prepareLocale>>,
): number {
  const selected = plan.jobs
    .map((job) => `${job.keys.length} ${job.kind} keys`)
    .join(", ");
  const costUsd =
    (plan.tokens * (costInPerMillion + costOutPerMillion)) / 1_000_000;
  process.stdout.write(
    `[${locale}] ${plan.glossary.missing.length} glossary terms selected.\n`,
  );
  process.stdout.write(
    `[${locale}] ${selected} selected. Estimated ~${plan.tokens} input tokens, ~${plan.tokens} output tokens, ~$${costUsd.toFixed(4)} USD.\n`,
  );
  return costUsd;
}

if (isEstimate) {
  for (const locale of targetLocales)
    logEstimate(locale, await prepareLocale(locale));
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
      "       OPENOKR_AI_API_KEY=... pnpm i18n:translate --provider anthropic|openai|google|openrouter --model <id> [--locale <code>] [--keys <prefix>] [--concurrency <n>]\n",
  );
  process.exit(2);
}

let totalSpendUsd = 0;
const costOf = (input: number, output: number) =>
  (input * costInPerMillion + output * costOutPerMillion) / 1_000_000;

for (const loc of targetLocales) {
  const plan = await prepareLocale(loc);
  const estimatedCostUsd = logEstimate(loc, plan);
  if (wantsLive && totalSpendUsd + estimatedCostUsd > 1.0) {
    process.stderr.write(
      "The estimated spend exceeds the command's USD 1 cap.\n",
    );
    await client.stop();
    process.exit(1);
  }

  const { path: glossaryPath, glossary, missing } = plan.glossary;
  if (missing.length > 0) {
    const draft = await translateCatalogue({
      provider: client,
      model: modelId,
      locale: loc,
      keys: missing,
      sourceCatalogue: sourceGlossary,
      targetCatalogue: glossary,
      pendingKeys: missing,
      concurrency,
      sameAsEnglish: { kpi: "Method acronym" },
      onProgress: (message) => process.stdout.write(`  glossary: ${message}\n`),
    });
    totalSpendUsd += costOf(draft.inputTokens, draft.outputTokens);
    if (draft.translatedCount > 0)
      await writeMessages(glossaryPath, sourceGlossary, glossary);
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

  for (const job of plan.jobs) {
    let translated = 0;
    let input = 0;
    let output = 0;
    let failures: readonly { readonly key: string; readonly error: string }[] =
      [];
    let remaining = [...job.pending];
    if (job.keys.length > 0) {
      const result = await translateCatalogue({
        provider: client,
        model: modelId,
        locale: loc,
        keys: job.keys,
        sourceCatalogue: job.source,
        targetCatalogue: job.target,
        pendingKeys: remaining,
        sameAsEnglish: job.sameAsEnglish,
        glossary,
        requireTranslation: true,
        concurrency,
        onProgress: (message) =>
          process.stdout.write(`  ${job.kind}: ${message}\n`),
      });
      translated = result.translatedCount;
      input = result.inputTokens;
      output = result.outputTokens;
      failures = result.failures;
      remaining = [...result.remainingPending];
    }

    if (
      Object.keys(job.target).length !== Object.keys(job.stored).length ||
      translated > 0
    ) {
      await writeMessages(job.path, job.source, job.target);
    }
    if (job.kind === "UI") {
      if (remaining.length > 0) pendingLedger[loc] = remaining;
      else delete pendingLedger[loc];
      await writeFile(
        pendingPath,
        `${JSON.stringify(pendingLedger, null, 2)}\n`,
      );
    }
    totalSpendUsd += costOf(input, output);
    process.stdout.write(
      `  ${loc} ${job.kind}: ${translated} translated, ${failures.length} failed (${input} in, ${output} out)\n`,
    );
    for (const failure of failures) {
      process.stdout.write(
        `      FAIL ${job.kind}:${failure.key}: ${failure.error}\n`,
      );
    }
  }
}

process.stdout.write(
  `\nTranslation complete. Total spend: $${totalSpendUsd.toFixed(4)} USD.\n`,
);

await client.stop();
