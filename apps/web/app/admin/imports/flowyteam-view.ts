/**
 * What the FlowyTeam card draws, worked out on the server from the runs
 * `imports.listRuns` returns (flowyteam-connect §4.5, card C5).
 *
 * Pure, so the step a workspace is on is tested without a browser: the card
 * itself only renders the phase this returns and the live progress on top.
 */
import {
  KPI_SHARES_NOTE_ROWS,
  KPI_SHARES_NOTE_TITLE,
  KPI_SHARES_VISIBLE_NOTE_PREFIX,
  type KpiSharesNoteRowKey,
} from "@openokr/core";

/** One run as `imports.listRuns` answers it, narrowed to what is read here. */
export interface RunRow {
  readonly id: string;
  readonly source: string;
  readonly mode: "dry_run" | "real";
  readonly status: string;
  readonly via: string | null;
  readonly rowsWritten: number;
  readonly rowsSkipped: number;
  readonly report: unknown;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

interface DomainRow {
  readonly domain: string;
  readonly read: number;
  readonly created: number;
  readonly matched: number;
  readonly skipped: number;
}

interface RestrictedKpi {
  readonly source: string;
  readonly reason: string;
}

interface UnreadRow {
  readonly table: string;
  readonly rows: number;
  readonly holds: string;
}

interface KpiSharesView {
  readonly rows: readonly {
    readonly key: KpiSharesNoteRowKey;
    readonly count: number;
  }[];
}

export interface PreviewView {
  readonly runId: string;
  readonly readAt: string | null;
  readonly domains: readonly DomainRow[];
  /** Rows the import would add. */
  readonly toAdd: number;
  readonly skipped: number;
  readonly restricted: readonly RestrictedKpi[];
  readonly combined: number;
  readonly recomputed: number;
  /** Engine notes other than the KPI shares block, which is `kpiShares`. */
  readonly notes: readonly string[];
  /** The dry-run KPI shares block as numbers, or null when it is absent. */
  readonly kpiShares: KpiSharesView | null;
  readonly unread: readonly UnreadRow[];
  readonly notImported: readonly string[];
}

interface FinishedView {
  readonly runId: string;
  readonly finishedAt: string | null;
  readonly written: number;
  readonly skipped: number;
}

export type FlowyteamPhase =
  | { readonly kind: "choose" }
  | { readonly kind: "previewing"; readonly runId: string }
  | { readonly kind: "preview"; readonly preview: PreviewView }
  | { readonly kind: "importing"; readonly runId: string }
  | { readonly kind: "linked"; readonly last: FinishedView };

export interface FlowyteamCardView {
  readonly phase: FlowyteamPhase;
  /** The latest browser run's failure word, when the latest one failed. */
  readonly failure: string | null;
  /** The last finished import, whatever the phase, for the linked line. */
  readonly lastImport: FinishedView | null;
}

const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * The same test `restrictedKpisIn` in `packages/core` applies to refuse a run
 * without the tick: a KPI shares flag saying it may become more visible.
 */
function isRestricted(flag: Record<string, unknown>): boolean {
  return (
    str(flag.source).startsWith("indicators:") &&
    str(flag.reason).startsWith("May become more visible")
  );
}

/**
 * Reads the engine's KPI shares text block back into numbers, with the labels
 * the engine printed it with. The second note, which lists the KPIs that may
 * become more visible, is the warning box's content, so it is dropped here.
 */
function splitKpiShares(notes: readonly string[]): {
  readonly rest: string[];
  readonly kpiShares: KpiSharesView | null;
} {
  const rest: string[] = [];
  let kpiShares: KpiSharesView | null = null;
  for (const note of notes) {
    if (note.startsWith(KPI_SHARES_VISIBLE_NOTE_PREFIX)) continue;
    if (!note.startsWith(KPI_SHARES_NOTE_TITLE)) {
      rest.push(note);
      continue;
    }
    const lines = note.split("\n");
    kpiShares = {
      rows: KPI_SHARES_NOTE_ROWS.flatMap((row) => {
        const prefix = `  ${row.label}`;
        const line = lines.find((l) => l.startsWith(prefix));
        const count = line
          ? Number(line.slice(prefix.length).trim())
          : Number.NaN;
        return Number.isFinite(count) ? [{ key: row.key, count }] : [];
      }),
    };
  }
  return { rest, kpiShares };
}

function previewOf(run: RunRow): PreviewView {
  const report = record(run.report);
  const domains: DomainRow[] = [];
  const restricted: RestrictedKpi[] = [];
  let combined = 0;
  let recomputed = 0;
  for (const raw of list(report.reconciliation)) {
    const row = record(raw);
    domains.push({
      domain: str(row.domain),
      read: num(row.read),
      created: num(row.created),
      matched: num(row.matched),
      skipped: list(row.skipped).length,
    });
    combined += num(row.combined);
    recomputed += num(row.recomputed);
    for (const flag of list(row.flags)) {
      const f = record(flag);
      if (isRestricted(f)) {
        restricted.push({ source: str(f.source), reason: str(f.reason) });
      }
    }
  }
  const { rest, kpiShares } = splitKpiShares(
    list(report.notes).map(str).filter(Boolean),
  );
  return {
    runId: run.id,
    readAt: run.finishedAt,
    domains,
    toAdd: domains.reduce((sum, row) => sum + row.created, 0),
    skipped: domains.reduce((sum, row) => sum + row.skipped, 0),
    restricted,
    combined,
    recomputed,
    notes: rest,
    kpiShares,
    unread: list(report.unreadTables).map((raw) => {
      const row = record(raw);
      return {
        table: str(row.table),
        rows: num(row.rows),
        holds: str(row.holds),
      };
    }),
    notImported: list(report.notImported).map(str).filter(Boolean),
  };
}

function finishedOf(run: RunRow): FinishedView {
  return {
    runId: run.id,
    finishedAt: run.finishedAt,
    written: run.rowsWritten,
    skipped: run.rowsSkipped,
  };
}

/**
 * The step the card is on, from the browser runs newest first.
 *
 * A run still `running` is in progress. Otherwise a finished preview newer
 * than the last import is waiting to be imported; a finished import with no
 * newer preview is the linked state; nothing is the choose step. A failed run
 * does not move the step: its failure is said above whichever step is next.
 */
export function flowyteamCardView(runs: readonly RunRow[]): FlowyteamCardView {
  const browser = runs.filter(
    (run) => run.source === "flowyteam" && run.via === "export",
  );
  const latest = browser[0];
  const lastImport = browser.find(
    (run) => run.mode === "real" && run.status === "completed",
  );
  const finished = lastImport ? finishedOf(lastImport) : null;
  const failure =
    latest?.status === "failed"
      ? str(record(latest.report).failure) || "error"
      : null;

  if (latest?.status === "running") {
    return {
      phase:
        latest.mode === "real"
          ? { kind: "importing", runId: latest.id }
          : { kind: "previewing", runId: latest.id },
      failure: null,
      lastImport: finished,
    };
  }
  const settled = browser.filter((run) => run.status === "completed");
  const newest = settled[0];
  if (newest?.mode === "dry_run") {
    return {
      phase: { kind: "preview", preview: previewOf(newest) },
      failure,
      lastImport: finished,
    };
  }
  if (finished) {
    return {
      phase: { kind: "linked", last: finished },
      failure,
      lastImport: finished,
    };
  }
  return { phase: { kind: "choose" }, failure, lastImport: null };
}
