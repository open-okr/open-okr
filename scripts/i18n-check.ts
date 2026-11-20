#!/usr/bin/env node
/**
 * Catalogue gate: verifies coverage, named holes, plural categories,
 * English-match ledgers and script requirements (docs/design/languages.md §6.2, §13).
 *
 * Checks both UI message catalogue (packages/ui/src/i18n/messages)
 * and server message catalogue (packages/core/src/i18n/messages).
 *
 * Usage:
 *   pnpm i18n:check
 *   pnpm i18n:check --release
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Catalogue } from "../packages/formats/src/index.ts";
import {
  type CheckIssue,
  checkCatalogues,
} from "../packages/ui/src/i18n/check.ts";
import {
  SAME_AS_ENGLISH,
  SERVER_SAME_AS_ENGLISH,
} from "../packages/ui/src/i18n/same-as-english.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const UI_MESSAGES_DIR = join(ROOT, "packages/ui/src/i18n/messages");
const CORE_MESSAGES_DIR = join(ROOT, "packages/core/src/i18n/messages");
const PENDING_FILE = join(ROOT, "packages/ui/src/i18n/pending.json");

async function checkDirectory(
  dir: string,
  sameAsEnglish: Record<string, Record<string, string>>,
  pending: Record<string, string[]>,
  isRelease: boolean,
): Promise<{ issues: CheckIssue[]; catalogueCount: number }> {
  const enRaw = await readFile(join(dir, "en.json"), "utf8");
  const en: Catalogue = JSON.parse(enRaw);

  const files = await readdir(dir);
  const catalogues: Record<string, Catalogue> = {};

  for (const file of files) {
    if (!file.endsWith(".json") || file === "en.json") {
      continue;
    }
    const locale = file.replace(/\.json$/, "");
    const raw = await readFile(join(dir, file), "utf8");
    catalogues[locale] = JSON.parse(raw);
  }

  // Filter sameAsEnglish entries to those in this directory's en catalogue
  const scopedSameAsEnglish: Record<string, Record<string, string>> = {};
  for (const [loc, entries] of Object.entries(sameAsEnglish)) {
    scopedSameAsEnglish[loc] = {};
    for (const [key, reason] of Object.entries(entries)) {
      if (en[key] !== undefined) {
        scopedSameAsEnglish[loc][key] = reason;
      }
    }
  }

  const issues = [
    ...checkCatalogues(en, catalogues, scopedSameAsEnglish, pending, {
      release: isRelease,
    }),
  ];

  return { issues, catalogueCount: Object.keys(catalogues).length + 1 };
}

async function main(): Promise<void> {
  const isRelease = process.argv.includes("--release");

  const pendingRaw = await readFile(PENDING_FILE, "utf8").catch(() => "{}");
  const pending: Record<string, string[]> = JSON.parse(pendingRaw);

  const uiResult = await checkDirectory(
    UI_MESSAGES_DIR,
    SAME_AS_ENGLISH,
    pending,
    isRelease,
  );

  const coreResult = await checkDirectory(
    CORE_MESSAGES_DIR,
    SERVER_SAME_AS_ENGLISH,
    {},
    isRelease,
  );

  const allIssues = [...uiResult.issues, ...coreResult.issues];

  if (allIssues.length > 0) {
    console.error(`FAIL i18n:check found ${allIssues.length} issue(s):`);
    for (const issue of allIssues) {
      const loc = issue.key ? `${issue.locale}:${issue.key}` : issue.locale;
      console.error(`  - [${issue.check}] ${loc}: ${issue.message}`);
    }
    process.exit(1);
  }

  console.log(
    `ok i18n checks passed across ${uiResult.catalogueCount} UI and ${coreResult.catalogueCount} server catalogues.`,
  );
}

main().catch((error) => {
  console.error("i18n:check failed with unexpected error:", error);
  process.exit(1);
});
