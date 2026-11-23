/**
 * FlowyTeam's read-only export over HTTPS (docs/design/flowyteam-connect.md
 * §4.3, §6 F5 and F6).
 *
 * `createHttpFlowyteamSource` is the HTTP twin of the importer's MySQL source:
 * it implements core's `Source` structurally, sending a catalogue name and its
 * values, never SQL. FlowyTeam binds the company from the token, so the
 * `company` argument is not sent.
 *
 * **Rows come back the way mysql2 returns them** in
 * `packages/importer/src/flowyteam/source.ts` (`dateStrings`,
 * `supportBigNumbers`, `bigNumberStrings`), so a mapper cannot tell the two
 * sources apart. FlowyTeam answers through PHP's PDO, which differs in three
 * places, and `columns[].native_type` says where: a `LONGLONG` arrives as a
 * number and mysql2 gives a string, a `JSON` arrives as text and mysql2 parses
 * it, and an integer or float may arrive as text when PDO stringifies.
 *
 * **Every request goes through the outbound guard**, so the air-gap checklist
 * sees it. No token is ever put in an error message.
 */
import {
  createGuardedFetch,
  type OutboundOptions,
  OutboundRefusedError,
  outboundFetch,
} from "../../outbound/guard.ts";
import type {
  FlowyteamExportColumn,
  FlowyteamFailure,
} from "../../ports/flowyteam.ts";

export interface HttpFlowyteamSourceOptions {
  readonly baseUrl: string;
  readonly accessToken: string;
  /** The catalogue version (`contract/flowyteam-queries.json`). */
  readonly version: string;
  /** The company name, for `describe`. */
  readonly label?: string;
  readonly allowPrivate?: boolean;
  /** Per request. */
  readonly timeoutMs?: number;
  /** The largest page answer read. A page is 2,000 rows. */
  readonly maxPageBytes?: number;
  /** Retries after the first try, for a 429, a 5xx or no answer. */
  readonly retries?: number;
  /** Milliseconds before the first retry; doubled each time. */
  readonly backoffMs?: number;
  /** How many pages one statement may take before it is refused. */
  readonly maxPages?: number;
  readonly fetchImpl?: typeof fetch;
  readonly resolve?: OutboundOptions["resolve"];
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * A refusal or failure from FlowyTeam's export, typed so the job can say the
 * right sentence: `version_mismatch` is "FlowyTeam needs an update",
 * `unauthorised` is "the access was revoked, connect again".
 */
export class FlowyteamExportError extends Error {
  readonly failure: FlowyteamFailure;
  readonly status: number | undefined;
  /** FlowyTeam's own error code, such as `invalid_token`. */
  readonly code: string | undefined;
  /** On a version mismatch: FlowyTeam's version, and the one sent. */
  readonly expected: string | undefined;
  readonly got: string | undefined;

  constructor(
    failure: FlowyteamFailure,
    message: string,
    extra: {
      readonly status?: number;
      readonly code?: string;
      readonly expected?: string;
      readonly got?: string;
    } = {},
  ) {
    super(message);
    this.name = "FlowyteamExportError";
    this.failure = failure;
    this.status = extra.status;
    this.code = extra.code;
    this.expected = extra.expected;
    this.got = extra.got;
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_PAGE_BYTES = 64 * 1024 * 1024;
const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 1_000;
const DEFAULT_MAX_PAGES = 10_000;

const INTEGER_TYPES = new Set(["TINY", "SHORT", "LONG", "INT24", "YEAR"]);
const FLOAT_TYPES = new Set(["FLOAT", "DOUBLE"]);

/**
 * One value as mysql2 would have returned it, given FlowyTeam's column type.
 *
 * Exported for the parity test. A type this does not name is passed through:
 * strings, text and dates already agree.
 */
export function coerceExportValue(
  value: unknown,
  nativeType: string | null | undefined,
): unknown {
  if (value === null || value === undefined || !nativeType) {
    return value ?? null;
  }
  const type = nativeType.toUpperCase();
  if (type === "LONGLONG") {
    // mysql2 with bigNumberStrings gives every BIGINT as its digits.
    return typeof value === "number" ? String(value) : value;
  }
  if (INTEGER_TYPES.has(type) || FLOAT_TYPES.has(type)) {
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);
      return Number.isNaN(parsed) ? value : parsed;
    }
    return value;
  }
  if (type === "NEWDECIMAL" || type === "DECIMAL") {
    // mysql2 keeps a decimal as text, so no digit is lost.
    return typeof value === "number" ? String(value) : value;
  }
  if (type === "JSON" && typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  return value;
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function parseObject(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const str = (value: unknown): string | undefined =>
  typeof value === "string" ? value.slice(0, 120) : undefined;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A status worth asking again about. */
const retryable = (status: number) => status === 429 || status >= 500;

export interface HttpFlowyteamSource {
  read<T = Record<string, unknown>>(
    name: string,
    values?: readonly unknown[],
    company?: number | string,
  ): Promise<T[]>;
  readonly database: string;
  readonly describe: string;
  /** A token holds one company: the `mysql-only` entries are refused. */
  readonly acrossCompanies: false;
  close(): Promise<void>;
}

export function createHttpFlowyteamSource(
  options: HttpFlowyteamSourceOptions,
): HttpFlowyteamSource {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const sleep = options.sleep ?? defaultSleep;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const host = (() => {
    try {
      return new URL(options.baseUrl).host;
    } catch {
      return options.baseUrl;
    }
  })();

  async function page(
    name: string,
    values: readonly unknown[],
    cursor: string | null,
  ): Promise<{
    rows: Record<string, unknown>[];
    columns: FlowyteamExportColumn[];
    next: string | null;
  }> {
    let lastDetail = "";
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempt > 0) {
        await sleep(backoffMs * 2 ** (attempt - 1));
      }
      const result = await outboundFetch(
        endpoint(options.baseUrl, "/api/export/v1/query"),
        {
          method: "POST",
          timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBytes: options.maxPageBytes ?? DEFAULT_MAX_PAGE_BYTES,
          body: JSON.stringify({
            version: options.version,
            name,
            values,
            cursor,
          }),
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${options.accessToken}`,
          },
          ...(options.allowPrivate ? { allowPrivate: true } : {}),
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
          ...(options.resolve ? { resolve: options.resolve } : {}),
        },
      );
      if (!result.ok) {
        if (
          result.refusal === "timed_out" ||
          result.refusal === "unreachable"
        ) {
          lastDetail = `${result.refusal}, ${result.detail}`;
          continue;
        }
        // An address the guard refuses, a redirect or an answer too large will
        // be the same next time.
        throw new FlowyteamExportError(
          "refused",
          `FlowyTeam's export for "${name}" was refused here: ${result.refusal}, ${result.detail}`,
        );
      }
      const body = parseObject(result.body);
      const code = str(body?.error);
      if (retryable(result.status)) {
        lastDetail = `answered ${result.status}${code ? ` (${code})` : ""}`;
        continue;
      }
      if (result.status === 409) {
        throw new FlowyteamExportError(
          "version_mismatch",
          `FlowyTeam runs another version of the query catalogue, so it needs an update before this import. FlowyTeam has ${str(body?.expected) ?? "an unknown version"}, this instance sent ${options.version}.`,
          {
            status: 409,
            ...(code ? { code } : {}),
            ...(str(body?.expected) ? { expected: str(body?.expected) } : {}),
            got: str(body?.got) ?? options.version,
          },
        );
      }
      if (
        result.status === 401 ||
        (result.status === 403 && code !== "mysql_only")
      ) {
        throw new FlowyteamExportError(
          "unauthorised",
          `FlowyTeam no longer accepts this connection's access${code ? ` (${code})` : ""}. Connect again from the import page.`,
          { status: result.status, ...(code ? { code } : {}) },
        );
      }
      if (result.status < 200 || result.status >= 300) {
        throw new FlowyteamExportError(
          "refused",
          `FlowyTeam refused "${name}" with ${result.status}${code ? ` (${code})` : ""}.`,
          { status: result.status, ...(code ? { code } : {}) },
        );
      }
      const rows = body?.rows;
      const columns = body?.columns;
      const next = body?.next_cursor;
      if (
        !Array.isArray(rows) ||
        !Array.isArray(columns) ||
        (next !== null && next !== undefined && typeof next !== "string")
      ) {
        throw new FlowyteamExportError(
          "bad_answer",
          `FlowyTeam answered "${name}" without rows, columns and a cursor.`,
          { status: result.status },
        );
      }
      return {
        rows: rows as Record<string, unknown>[],
        columns: columns as FlowyteamExportColumn[],
        next: typeof next === "string" && next !== "" ? next : null,
      };
    }
    throw new FlowyteamExportError(
      "unreachable",
      `FlowyTeam did not answer "${name}" after ${retries + 1} tries: ${lastDetail}.`,
    );
  }

  return {
    database: "flowyteam",
    acrossCompanies: false,
    describe: `${options.label ? `${options.label} at ` : ""}${host} (FlowyTeam export)`,
    async read<T>(name: string, values: readonly unknown[] = []): Promise<T[]> {
      const out: Record<string, unknown>[] = [];
      let cursor: string | null = null;
      for (let n = 0; n < maxPages; n += 1) {
        const answer = await page(name, values, cursor);
        const types = new Map(
          answer.columns.map((column) => [column.name, column.native_type]),
        );
        for (const row of answer.rows) {
          const coerced: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(row)) {
            coerced[key] = coerceExportValue(value, types.get(key));
          }
          out.push(coerced);
        }
        if (answer.next === null) {
          return out as T[];
        }
        cursor = answer.next;
      }
      throw new FlowyteamExportError(
        "bad_answer",
        `FlowyTeam kept paging "${name}" past ${maxPages} pages.`,
      );
    },
    async close(): Promise<void> {
      // Nothing is held open between requests.
    },
  };
}

export interface HttpFlowyteamFilesOptions {
  readonly baseUrl: string;
  readonly accessToken: string;
  /** The storage port's per-file limit. A file over it is not read. */
  readonly maxBytes: number;
  readonly allowPrivate?: boolean;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly resolve?: OutboundOptions["resolve"];
}

export type FetchedFlowyteamFile =
  | { readonly ok: true; readonly bytes: Buffer }
  | { readonly ok: false; readonly reason: string };

/**
 * One task file from `GET /api/export/v1/files/{id}` (F6), streamed under the
 * size limit. A refusal is a sentence for the report, completing
 * `"<filename>" ...`; an access FlowyTeam no longer accepts throws, because
 * every file after it would be refused the same way.
 */
export function createHttpFlowyteamFiles(
  options: HttpFlowyteamFilesOptions,
): (taskFileId: number) => Promise<FetchedFlowyteamFile> {
  const guarded = createGuardedFetch({
    ...(options.allowPrivate ? { allowPrivate: true } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.resolve ? { resolve: options.resolve } : {}),
  });
  const limitText = `${Math.floor(options.maxBytes / (1024 * 1024))} MB`;
  return async (taskFileId) => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    try {
      let response: Response;
      try {
        response = await guarded(
          endpoint(options.baseUrl, `/api/export/v1/files/${taskFileId}`),
          {
            method: "GET",
            signal: controller.signal,
            headers: { authorization: `Bearer ${options.accessToken}` },
          },
        );
      } catch (error) {
        const detail =
          error instanceof OutboundRefusedError
            ? error.refusal
            : controller.signal.aborted
              ? "timed out"
              : "no answer";
        return {
          ok: false,
          reason: `could not be fetched from FlowyTeam (${detail}).`,
        };
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel().catch(() => undefined);
        throw new FlowyteamExportError(
          "unauthorised",
          "FlowyTeam no longer accepts this connection's access. Connect again from the import page.",
          { status: response.status },
        );
      }
      if (response.status !== 200) {
        const code = str(parseObject(await response.text())?.error);
        return {
          ok: false,
          reason:
            code === "file_not_stored"
              ? "is not stored on FlowyTeam's disk, so there is nothing to fetch."
              : `was refused by FlowyTeam's file endpoint (${response.status}${code ? `, ${code}` : ""}).`,
        };
      }
      const declared = Number.parseInt(
        response.headers.get("content-length") ?? "",
        10,
      );
      if (Number.isFinite(declared) && declared > options.maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        return {
          ok: false,
          reason: `is larger than the ${limitText} a stored file may be, so it was not copied.`,
        };
      }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > options.maxBytes) {
            await reader.cancel().catch(() => undefined);
            return {
              ok: false,
              reason: `is larger than the ${limitText} a stored file may be, so it was not copied.`,
            };
          }
          chunks.push(value);
        }
      }
      return { ok: true, bytes: Buffer.concat(chunks) };
    } finally {
      clearTimeout(timer);
    }
  };
}
