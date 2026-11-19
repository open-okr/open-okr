#!/usr/bin/env node
/**
 * Synchronises non-English catalogues with English (docs/design/languages.md §6.1, §13).
 *
 * For each locale catalogue that exists on disk across UI and server packages:
 * - Copies new keys from English and records them in pending.json.
 * - Removes keys that have been deleted from English.
 * - Sorts keys to match English catalogue order.
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
const UI_MESSAGES_DIR = join(ROOT, "packages/ui/src/i18n/messages");
const CORE_MESSAGES_DIR = join(ROOT, "packages/core/src/i18n/messages");
const PENDING_FILE = join(ROOT, "packages/ui/src/i18n/pending.json");

async function syncDirectory(
  dir: string,
  pending: Record<string, string[]>,
  recordPending = true,
): Promise<{ added: number; removed: number }> {
  const enRaw = await readFile(join(dir, "en.json"), "utf8");
  const en: Catalogue = JSON.parse(enRaw);

  const files = await readdir(dir);
  let totalAdded = 0;
  let totalRemoved = 0;

  for (const file of files.sort()) {
    if (!file.endsWith(".json") || file === "en.json") {
      continue;
    }
    const locale = file.replace(/\.json$/, "");
    const filePath = join(dir, file);
    const raw = await readFile(filePath, "utf8");
    const target: Catalogue = JSON.parse(raw);

    const { updatedTarget, updatedPending, added, removed } = syncCatalogue(
      locale,
      en,
      target,
      recordPending ? pending[locale] ?? [] : [],
    );

    // Sort target keys matching en.json order
    const sortedTarget: Record<string, string> = {};
    for (const key of Object.keys(en)) {
      if (updatedTarget[key] !== undefined) {
        sortedTarget[key] = updatedTarget[key];
      }
    }
    for (const key of Object.keys(updatedTarget).sort()) {
      if (sortedTarget[key] === undefined) {
        sortedTarget[key] = updatedTarget[key];
      }
    }

    await writeFile(
      filePath,
      `${JSON.stringify(sortedTarget, null, 2)}\n`,
      "utf8",
    );

    if (recordPending) {
      if (updatedPending.length > 0) {
        pending[locale] = updatedPending;
      } else {
        delete pending[locale];
      }
    }

    totalAdded += added.length;
    totalRemoved += removed.length;

    if (added.length > 0 || removed.length > 0) {
      console.log(
        `synced ${dir}/${locale}: +${added.length} added, -${removed.length} removed`,
      );
    }
  }

  return { added: totalAdded, removed: totalRemoved };
}

async function main(): Promise<void> {
  const pendingRaw = await readFile(PENDING_FILE, "utf8").catch(() => "{}");
  const pending: Record<string, string[]> = JSON.parse(pendingRaw);

  const uiSync = await syncDirectory(UI_MESSAGES_DIR, pending, true);
  const coreSync = await syncDirectory(CORE_MESSAGES_DIR, pending, false);

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

  const totalAdded = uiSync.added + coreSync.added;
  const totalRemoved = uiSync.removed + coreSync.removed;
  console.log(
    `ok i18n sync complete: ${totalAdded} added, ${totalRemoved} removed.`,
  );
}

main().catch((error) => {
  console.error("i18n:sync failed with unexpected error:", error);
  process.exit(1);
});
