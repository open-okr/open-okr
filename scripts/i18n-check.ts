#!/usr/bin/env node
/**
 * Catalogue gate: verifies coverage, named holes, plural categories,
 * English-match ledgers and script requirements (docs/design/languages.md §6.2).
 *
 * Usage:
 *   pnpm i18n:check
 *   pnpm i18n:check --release
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Catalogue, LOCALES } from "../packages/formats/src/index.ts";
import {
  type CheckIssue,
  checkCatalogues,
} from "../packages/ui/src/i18n/check.ts";
import { SAME_AS_ENGLISH } from "../packages/ui/src/i18n/same-as-english.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MESSAGES_DIR = join(ROOT, "packages/ui/src/i18n/messages");
const PENDING_FILE = join(ROOT, "packages/ui/src/i18n/pending.json");

async function main(): Promise<void> {
  const isRelease = process.argv.includes("--release");

  const enRaw = await readFile(join(MESSAGES_DIR, "en.json"), "utf8");
  const en: Catalogue = JSON.parse(enRaw);

  const pendingRaw = await readFile(PENDING_FILE, "utf8").catch(() => "{}");
  const pending: Record<string, string[]> = JSON.parse(pendingRaw);

  const files = await readdir(MESSAGES_DIR);
  const catalogues: Record<string, Catalogue> = {};

  for (const file of files) {
    if (!file.endsWith(".json") || file === "en.json") {
      continue;
    }
    const locale = file.replace(/\.json$/, "");
    const raw = await readFile(join(MESSAGES_DIR, file), "utf8");
    catalogues[locale] = JSON.parse(raw);
  }

  // Find intl tags from registry
  const localeMap = new Map(LOCALES.map((l) => [l.code, l]));

  const issues: CheckIssue[] = [
    ...checkCatalogues(en, catalogues, SAME_AS_ENGLISH, pending, {
      release: isRelease,
    }),
  ];

  if (issues.length > 0) {
    console.error(`FAIL i18n:check found ${issues.length} issue(s):`);
    for (const issue of issues) {
      const loc = issue.key ? `${issue.locale}:${issue.key}` : issue.locale;
      console.error(`  - [${issue.check}] ${loc}: ${issue.message}`);
    }
    process.exit(1);
  }

  const localeCount = Object.keys(catalogues).length + 1;
  console.log(`ok i18n checks passed across ${localeCount} catalogues.`);
}

main().catch((error) => {
  console.error("i18n:check failed with unexpected error:", error);
  process.exit(1);
});
