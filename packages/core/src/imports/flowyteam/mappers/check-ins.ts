/**
 * The history behind the numbers (TECHNICAL-PLAN §7.2, P6-T03c).
 *
 * **One narrative check-in per objective per period, which is not the shape the
 * source keeps.** FlowyTeam writes an `objective_checkins` row for the
 * objective and a `key_result_checkins` row for each measure, all pointing at
 * the same `checkin_id`. This product writes one check-in carrying a narrative,
 * a confidence and a snapshot of every measure that moved. So the mapper groups
 * the source's rows by objective and period, and each group becomes one
 * check-in whose values are the key-result rows that came with it.
 *
 * **The author and the date are the source's, not the migration's.** Every
 * check-in was written by somebody months ago, and an import that stamped them
 * all with today's date under the migrator's name would produce a history that
 * says nothing true. `goals.importCheckIn` exists for exactly that.
 *
 * **Votes are not imported, and there is nothing to import.** A private
 * confidence vote with a synchronised reveal is an OpenOKR concept; the source
 * has one confidence per check-in and no notion of a room voting.
 */

import { confidenceBand, type ResolvedThresholds } from "@openokr/method";
import type { ActionCallContext } from "../../../actions/define.ts";
import { callAction } from "../../../actions/registry.ts";
import { richTextFromPlainText } from "../../../rich-text/from-text.ts";
import { legacyKeyFor } from "../legacy.ts";
import type { Source } from "../source.ts";
import { sourceInstant } from "../time.ts";
import { type DomainReconciliation, DomainTally } from "./reconcile.ts";
import type { Resolver } from "./resolve.ts";

export interface CheckInResult {
  readonly domains: readonly DomainReconciliation[];
  /** What changed on the way in, for the report. */
  readonly notes: readonly string[];
  /**
   * Stand-alone key result rows of groups with no remark at all. They have no
   * narrative to make a check-in from, so the key result history takes their
   * values instead (design §2.4).
   */
  readonly valueOnly: readonly StandaloneKeyResultRow[];
}

interface MapperOptions {
  readonly source: Source;
  readonly context: ActionCallContext;
  readonly companyId: number;
  readonly resolver: Resolver;
  readonly actingMemberId: string;
  readonly write: boolean;
}

export async function importCheckIns(
  options: MapperOptions,
): Promise<CheckInResult> {
  const { domain, notes, valueOnly } = await importObjectiveCheckIns(options);
  return { domains: [domain], notes, valueOnly };
}

interface SourceObjectiveCheckIn {
  id: number;
  objective_id: number;
  user_id: number | null;
  checkin_id: number | null;
  start_date: string | null;
  end_date: string | null;
  confidence: number | null;
  remarks: string | null;
  created_at: string | null;
}

interface SourceKeyResultCheckIn {
  key_result_id: number;
  current_value: number | null;
  confidence: number | null;
  remarks: string | null;
}

/**
 * FlowyTeam's confidence is 0 to 10; this product's is 0 to 1.
 *
 * Anything outside the range is clamped rather than refused: a stored 11 is a
 * bug in the old system, not a reason to lose the check-in it belongs to.
 */
function confidenceOf(raw: number | null): number {
  const value = Number(raw ?? 0);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value / 10));
}

/**
 * The status METHOD.md asks a check-in to carry, from the confidence.
 *
 * FlowyTeam has no status column: it has a 0 to 10 confidence and computes a
 * colour from it. The bands are this workspace's own §3.2 boundaries, through
 * `confidenceBand` (completeness review H-17: they were 0.7 and 0.4 written
 * here), so an imported check-in carries the status this instance would have
 * given it rather than one translated from a colour the old system drew.
 */
const STATUS_FOR_BAND = {
  high: "on_track",
  medium: "caution",
  low: "off_track",
} as const;

function statusFor(
  confidence: number,
  thresholds: ResolvedThresholds,
): "on_track" | "caution" | "off_track" {
  return STATUS_FOR_BAND[confidenceBand(confidence, thresholds).band];
}

async function importObjectiveCheckIns(options: MapperOptions): Promise<{
  domain: DomainReconciliation;
  notes: string[];
  valueOnly: StandaloneKeyResultRow[];
}> {
  const tally = new DomainTally("check-ins");
  const thresholds = (await callAction(options.context, "rhythm.read", {}))
    .thresholds as unknown as ResolvedThresholds;
  const rows = await options.source.read<SourceObjectiveCheckIn>(
    "checkIns.objectiveCheckIns",
    [],
    options.companyId,
  );

  for (const row of rows) {
    tally.sawRow();
    const source = `objective_checkins:${row.id}`;

    const goalId = await options.resolver.resolve(
      "objectives",
      row.objective_id,
    );
    if (!goalId) {
      tally.skip(
        source,
        `Objective ${row.objective_id} did not import, so its check-in could not either.`,
      );
      continue;
    }

    const publishedAt = row.created_at ?? row.end_date ?? row.start_date;
    if (!publishedAt) {
      // §7.2 asks the report to name every check-in whose period could not be
      // resolved. A check-in with no date at all is the extreme case of that:
      // there is nowhere in the history to put it.
      tally.skip(
        source,
        "This check-in has no date in the source, so there is nowhere in the history to put it.",
      );
      continue;
    }

    const author = row.user_id
      ? await options.resolver.resolve("users", row.user_id)
      : undefined;
    if (!author) {
      // Attributing it to the migrator would put words in somebody's mouth and
      // make the imported history read as though one person wrote all of it.
      tally.skip(
        source,
        row.user_id
          ? `The person who wrote this check-in (user ${row.user_id}) did not import.`
          : "This check-in has no author in the source.",
      );
      continue;
    }

    const remarks = (row.remarks ?? "").trim();
    if (remarks === "") {
      // METHOD.md requires a narrative, and the publish path refuses without
      // one. An empty check-in in the source is a row somebody clicked through,
      // and inventing a sentence for it would be inventing the history.
      tally.skip(
        source,
        "This check-in has no narrative in the source, and a check-in without one says nothing.",
      );
      continue;
    }

    if (!options.write) {
      tally.wrote(true);
      continue;
    }

    // **The measures that moved with it.** Grouped by the source's own
    // `checkin_id` where there is one, and by the objective's period where
    // there is not: FlowyTeam has rows from before `checkins` existed.
    const values = await valuesFor(options, row);

    try {
      await callAction(options.context, "goals.importCheckIn", {
        goalId,
        authorMemberId: author,
        status: statusFor(confidenceOf(row.confidence), thresholds),
        confidence: confidenceOf(row.confidence),
        narrative: richTextFromPlainText(remarks),
        values,
        // Read as UTC, not as this machine's local time: see `sourceInstant`.
        publishedAt: sourceInstant(publishedAt) as string,
        legacy: legacyKeyFor("objective_checkins", row.id),
        ...(await acknowledgementFor(options, row)),
      });
      tally.wrote(true);
    } catch (error) {
      const message = messageOf(error);
      if (message.includes("already carries")) {
        // An earlier run wrote it. The legacy key is doing its work.
        tally.wrote(false);
        continue;
      }
      tally.skip(source, message);
    }
  }

  // Counted in the same domain: to a person these are all "check-ins".
  const { notes, valueOnly } = await importStandaloneKeyResultCheckIns(
    options,
    tally,
    thresholds,
  );
  return { domain: tally.finish(), notes, valueOnly };
}

export interface StandaloneKeyResultRow {
  id: number;
  key_result_id: number;
  objective_id: number;
  user_id: number | null;
  start_date: string | null;
  end_date: string | null;
  current_value: number | null;
  confidence: number | null;
  remarks: string | null;
  created_at: string | null;
}

/**
 * Key result rows that have no objective check-in of the same period.
 *
 * **One check-in per objective per period, same as the path above.** On
 * OKRI.io 98% of key result rows were written without an objective row, so
 * reading only through `objective_checkins` dropped them without a word. The
 * rows are grouped by objective and period (a row with no dates is its own
 * period, keyed on the day it was written), and the group's lowest id is its
 * legacy key so a second run finds it.
 *
 * Returns the note for the report, empty when there was nothing to group.
 */
async function importStandaloneKeyResultCheckIns(
  options: MapperOptions,
  tally: DomainTally,
  thresholds: ResolvedThresholds,
): Promise<{ notes: string[]; valueOnly: StandaloneKeyResultRow[] }> {
  const rows = await options.source.read<StandaloneKeyResultRow>(
    "checkIns.standaloneKeyResults",
    [],
    options.companyId,
  );
  if (rows.length === 0) {
    return { notes: [], valueOnly: [] };
  }

  const titles = new Map(
    (
      await options.source.read<{ id: number; title: string | null }>(
        "okrs.keyResults",
        [],
        options.companyId,
      )
    ).map((row) => [row.id, (row.title ?? "").trim()]),
  );

  const groups = new Map<string, StandaloneKeyResultRow[]>();
  for (const row of rows) {
    const period =
      row.start_date === null && row.end_date === null
        ? `created:${String(row.created_at ?? "").slice(0, 10)}`
        : `${row.start_date}|${row.end_date}`;
    const key = `${row.objective_id}|${period}`;
    const group = groups.get(key);
    if (group) {
      group.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  const valueOnly: StandaloneKeyResultRow[] = [];
  let grouped = 0;
  for (const group of groups.values()) {
    const first = group[0] as StandaloneKeyResultRow;
    if (group.every((row) => (row.remarks ?? "").trim() === "")) {
      // Nothing to say, so no check-in. An objective that did not import still
      // skips here, as it always did.
      const goalId = await options.resolver.resolve(
        "objectives",
        first.objective_id,
      );
      if (goalId) {
        valueOnly.push(...group);
        continue;
      }
    }
    for (let n = 0; n < group.length; n += 1) {
      tally.sawRow();
    }
    grouped += 1;
    await importStandaloneGroup(options, tally, thresholds, group, titles);
  }

  const notes: string[] = [];
  const checkInRows = rows.length - valueOnly.length;
  if (checkInRows > 0) {
    notes.push(
      `${checkInRows} key result check-ins had no objective check-in and were grouped into ${grouped} check-ins, one per objective and period.`,
    );
  }
  return { notes, valueOnly };
}

async function importStandaloneGroup(
  options: MapperOptions,
  tally: DomainTally,
  thresholds: ResolvedThresholds,
  group: StandaloneKeyResultRow[],
  titles: ReadonlyMap<number, string>,
): Promise<void> {
  const skipAll = (reason: (row: StandaloneKeyResultRow) => string): void => {
    for (const row of group) {
      tally.skip(`key_result_checkins:${row.id}`, reason(row));
    }
  };
  // Rows arrive ordered by created_at then id, so the last one is the latest.
  const latest = group[group.length - 1] as StandaloneKeyResultRow;
  const first = group.reduce((low, row) => (row.id < low.id ? row : low));
  const source = `key_result_checkins:${first.id}`;

  const goalId = await options.resolver.resolve(
    "objectives",
    latest.objective_id,
  );
  if (!goalId) {
    skipAll(
      () =>
        `Objective ${latest.objective_id} did not import, so its check-in could not either.`,
    );
    return;
  }

  const authorIds = [
    ...new Set(group.flatMap((row) => (row.user_id ? [row.user_id] : []))),
  ];
  const author = latest.user_id
    ? await options.resolver.resolve("users", latest.user_id)
    : undefined;
  if (!author) {
    // Same rule as an objective check-in: never put the migrator's name on it.
    skipAll(() =>
      latest.user_id
        ? `The person who wrote this check-in (user ${latest.user_id}) did not import.`
        : "This check-in has no author in the source.",
    );
    return;
  }
  if (authorIds.length > 1) {
    tally.flag(
      source,
      `Written by users ${authorIds.join(", ")} for one period. Imported under the latest row's author, user ${latest.user_id}.`,
    );
  }

  const publishedAt = latest.created_at ?? latest.end_date ?? latest.start_date;
  if (!publishedAt) {
    skipAll(
      () =>
        "This check-in has no date in the source, so there is nowhere in the history to put it.",
    );
    return;
  }

  // One value per key result: the later row wins, the earlier is named.
  const values = new Map<number, { keyResultId: string; value: number }>();
  const winner = new Map<number, number>();
  const usable: StandaloneKeyResultRow[] = [];
  for (const row of group) {
    const keyResultId = await options.resolver.resolve(
      "key_results",
      row.key_result_id,
    );
    if (!keyResultId) {
      tally.skip(
        `key_result_checkins:${row.id}`,
        `Key result ${row.key_result_id} did not import, so its check-in row could not either.`,
      );
      continue;
    }
    usable.push(row);
    const previous = winner.get(row.key_result_id);
    if (previous !== undefined) {
      tally.flag(
        `key_result_checkins:${previous}`,
        `Superseded by key_result_checkins:${row.id}, a later row for the same key result and period.`,
      );
    }
    winner.set(row.key_result_id, row.id);
    const value = Number(row.current_value ?? Number.NaN);
    if (Number.isFinite(value)) {
      values.set(row.key_result_id, { keyResultId, value });
    } else {
      values.delete(row.key_result_id);
    }
  }
  if (usable.length === 0) {
    return;
  }

  const lines = usable.flatMap((row) => {
    const remark = (row.remarks ?? "").trim();
    if (remark === "") {
      return [];
    }
    const title = titles.get(row.key_result_id) ?? "";
    return [title ? `${title}: ${remark}` : remark];
  });
  if (lines.length === 0) {
    for (const row of usable) {
      tally.skip(
        `key_result_checkins:${row.id}`,
        "This check-in has no narrative in the source, and a check-in without one says nothing.",
      );
    }
    return;
  }

  // Rows of the group that are not the group's own (skipped ones aside) fold
  // into the one check-in, named so nothing is lost silently.
  // The legacy key stays on the group's lowest id even when that row itself
  // was skipped, so a later run that can read it still finds the same key.
  const lowestUsable = usableFirst(usable);
  const combinedIds = usable
    .filter((row) => row.id !== lowestUsable.id)
    .map((row) => row.id);
  const confidence = Math.min(
    ...usable.map((row) => confidenceOf(row.confidence)),
  );
  const legacy = legacyKeyFor("key_result_checkins", first.id);

  const flagCombined = (): void => {
    tally.combinedInto(combinedIds.length);
    if (combinedIds.length > 0) {
      tally.flag(
        `key_result_checkins:${lowestUsable.id}`,
        `Combined with ${combinedIds.map((id) => `key_result_checkins:${id}`).join(", ")} into one check-in for the objective's period.`,
      );
    }
  };

  if (!options.write) {
    tally.wrote(true);
    flagCombined();
    return;
  }

  try {
    await callAction(options.context, "goals.importCheckIn", {
      goalId,
      authorMemberId: author,
      status: statusFor(confidence, thresholds),
      confidence,
      narrative: richTextFromPlainText(lines.join("\n")),
      values: [...values.values()],
      publishedAt: sourceInstant(publishedAt) as string,
      legacy,
    });
    tally.wrote(true);
    flagCombined();
  } catch (error) {
    const message = messageOf(error);
    if (message.includes("already carries")) {
      tally.wrote(false);
      flagCombined();
      return;
    }
    tally.skip(source, message);
  }
}

function usableFirst(rows: StandaloneKeyResultRow[]): StandaloneKeyResultRow {
  return rows.reduce((low, row) => (row.id < low.id ? row : low));
}

/** The key-result movements that belong to this check-in. */
async function valuesFor(
  options: MapperOptions,
  row: SourceObjectiveCheckIn,
): Promise<{ keyResultId: string; value: number }[]> {
  const measures = row.checkin_id
    ? await options.source.read<SourceKeyResultCheckIn>(
        "checkIns.keyResultsByCheckIn",
        [row.checkin_id],
        options.companyId,
      )
    : await options.source.read<SourceKeyResultCheckIn>(
        "checkIns.keyResultsByPeriod",
        [row.objective_id, row.start_date, row.end_date],
        options.companyId,
      );

  const values: { keyResultId: string; value: number }[] = [];
  for (const measure of measures) {
    const keyResultId = await options.resolver.resolve(
      "key_results",
      measure.key_result_id,
    );
    const value = Number(measure.current_value ?? Number.NaN);
    if (keyResultId && Number.isFinite(value)) {
      values.push({ keyResultId, value });
    }
  }
  return values;
}

/** Who reviewed it, where the source recorded a review. */
async function acknowledgementFor(
  options: MapperOptions,
  row: SourceObjectiveCheckIn,
): Promise<{ acknowledgedById?: string; acknowledgedAt?: string }> {
  if (!row.checkin_id) {
    return {};
  }
  const reviews = await options.source.read<{
    user_id: number | null;
    created_at: string | null;
  }>("checkIns.reviews", [row.checkin_id], options.companyId);
  const review = reviews[0];
  if (!review?.user_id) {
    return {};
  }
  const reviewer = await options.resolver.resolve("users", review.user_id);
  if (!reviewer) {
    // A review by somebody who did not import is not an acknowledgement this
    // instance can attribute. The check-in still imports, unacknowledged, which
    // is what the review inbox will then show as still open.
    return {};
  }
  return {
    acknowledgedById: reviewer,
    ...(sourceInstant(review.created_at)
      ? { acknowledgedAt: sourceInstant(review.created_at) as string }
      : {}),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Something went wrong importing that check-in.";
}
