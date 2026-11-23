/**
 * `pnpm import:flowyteam`'s run: the engine over a MySQL source.
 *
 * The engine itself lives in core (`packages/core/src/imports/flowyteam`,
 * flowyteam-connect card C2), so the web application can run it without the
 * MySQL client. What is left here is what only a terminal has: a
 * `mysql://` address to open, and a local `--files-root` to read.
 */
import type { FileStorage } from "@openokr/adapters";
import {
  type FlowyteamRunResult,
  runFlowyteamEngine,
  type Source,
} from "@openokr/core";
import type { Pool } from "pg";
import { filesRootReader } from "./files.ts";
import { openSource } from "./source.ts";

export interface FlowyteamRunOptions {
  readonly pool: Pool;
  readonly workspaceId: string;
  /** The member every write is authorised as. */
  readonly userId: string;
  /** A `mysql://user:password@host:port/database` address. */
  readonly url: string;
  readonly companyId: number | undefined;
  /** Opened for the caller when given, which is how the tests supply one. */
  readonly source?: Source;
  /** False reports what a real run would do and writes nothing (P6-T03a). */
  readonly write?: boolean;
  /**
   * Where this instance keeps its own bytes (P6-T04c). Built by the entry
   * point from `OPENOKR_STORAGE_ROOT`, and supplied directly by the tests.
   */
  readonly storage?: FileStorage;
  /** The FlowyTeam server's storage directory, from `--files-root`. */
  readonly filesRoot?: string;
  /** Which domains to import, from `--only` (P6-T04d). */
  readonly only?: readonly string[];
  /** From `--accept-broader-visibility`. */
  readonly acceptBroaderVisibility?: boolean;
}

export async function runFlowyteamImport(
  options: FlowyteamRunOptions,
): Promise<FlowyteamRunResult> {
  const source = options.source ?? (await openSource({ url: options.url }));
  const ownsSource = options.source === undefined;
  const { url: _url, filesRoot, source: _source, ...rest } = options;
  try {
    return await runFlowyteamEngine({
      ...rest,
      source,
      ...(filesRoot ? { files: filesRootReader(filesRoot) } : {}),
    });
  } finally {
    if (ownsSource) {
      await source.close();
    }
  }
}
