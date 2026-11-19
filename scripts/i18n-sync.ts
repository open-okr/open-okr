#!/usr/bin/env node
/**
 * Synchronises non-English catalogues with English (docs/design/languages.md §6.1).
 *
 * For each locale catalogue that exists on disk:
 * - Copies new keys from English and records them in pending.json.
 * - Removes keys that have been deleted from English.
 * - Sorts keys alphabetically.
 *
 * Usage:
 *   pnpm i18n:sync
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Catalogue } from "../packages/formats/src/index.ts";
import { syncCatalogue } from "../packages/ui/src/i18n/check.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MESSAGES_DIR = join(ROOT, "packages/ui/src/i18n/messages");
const PENDING_FILE = join(ROOT, "packages/ui/src/i18n/pending.json");

async function main(): Promise<void> {
  const enRaw = await readFile(join(MESSAGES_DIR, "en.json"), "utf8");
  const en: Catalogue = JSON.parse(enRaw);

  const pendingRaw = await readFile(PENDING_FILE, "utf8").catch(() => "{}");
  const pending: Record<string, string[]> = JSON.parse(pendingRaw);

  const files = await readdir(MESSAGES_DIR);
  let totalAdded = 0;
  let totalRemoved = 0;

  for (const file of files.sort()) {
    if (!file.endsWith(".json") || file === "en.json") {
      continue;
    }
    const locale = file.replace(/\.json$/, "");
    const filePath = join(MESSAGES_DIR, file);
    const raw = await readFile(filePath, "utf8");
    const target: Catalogue = JSON.parse(raw);

    const { updatedTarget, updatedPending, added, removed } = syncCatalogue(
      locale,
      en,
      target,
      pending[locale] ?? [],
    );

    // Sort target keys
    const sortedTarget: Record<string, string> = {};
    for (const key of Object.keys(updatedTarget).sort()) {
      sortedTarget[key] = updatedTarget[key];
    }

    await writeFile(
      filePath,
      `${JSON.stringify(sortedTarget, null, 2)}\n`,
      "utf8",
    );

    if (updatedPending.length > 0) {
      pending[locale] = updatedPending;
    } else {
      delete pending[locale];
    }

    totalAdded += added.length;
    totalRemoved += removed.length;

    if (added.length > 0 || removed.length > 0) {
      console.log(
        `synced ${locale}: +${added.length} added (recorded in pending), -${removed.length} removed`,
      );
    }
  }

  // Write sorted pending.json
  const sortedPending: Record<string, string[]> = {};
  for (const locale of Object.keys(pending).sort()) {
    if (pending[locale] && pending[locale].length > 0) {
      sortedPending[locale] = pending[locale].sort();
    }
  }

  await writeFile(
    PENDING_FILE,
    `${JSON.stringify(sortedPending, null, 2)}\n`,
    "utf8",
  );

  console.log(
    `ok i18n sync complete: ${totalAdded} added, ${totalRemoved} removed.`,
  );
}

main().catch((error) => {
  console.error("i18n:sync failed with unexpected error:", error);
  process.exit(1);
});
