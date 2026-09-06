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
import {
  type ActionCallContext,
  callAction,
  richTextFromPlainText,
} from "@openokr/core";
import { legacyKeyFor } from "../legacy.ts";
import type { Source } from "../source.ts";
import { sourceInstant } from "../time.ts";
import { type DomainReconciliation, DomainTally } from "./reconcile.ts";
import type { Resolver } from "./resolve.ts";

export interface CheckInResult {
  readonly domains: readonly DomainReconciliation[];
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
  return { domains: [await importObjectiveCheckIns(options)] };
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
 * colour from it. The bands here are the product's own (METHOD.md §3.6 reads
 * confidence the same way), so an imported check-in carries the status this
 * instance would have given it rather than one translated from a colour the old
 * system happened to draw.
 */
function statusFor(confidence: number): "on_track" | "caution" | "off_track" {
  if (confidence >= 0.7) {
    return "on_track";
  }
  return confidence >= 0.4 ? "caution" : "off_track";
}

async function importObjectiveCheckIns(
  options: MapperOptions,
): Promise<DomainReconciliation> {
  const tally = new DomainTally("check-ins");
  const rows = await options.source.query<SourceObjectiveCheckIn>(
    `select c.id, c.objective_id, c.user_id, c.checkin_id, c.start_date,
            c.end_date, c.confidence, c.remarks, c.created_at
       from objective_checkins c
       join objectives o on o.id = c.objective_id
      where c.company_id = ? and o.deleted_at is null
      order by c.created_at, c.id`,
    [options.companyId],
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
        status: statusFor(confidenceOf(row.confidence)),
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

  return tally.finish();
}

/** The key-result movements that belong to this check-in. */
async function valuesFor(
  options: MapperOptions,
  row: SourceObjectiveCheckIn,
): Promise<{ keyResultId: string; value: number }[]> {
  const measures = row.checkin_id
    ? await options.source.query<SourceKeyResultCheckIn>(
        `select key_result_id, current_value, confidence, remarks
           from key_result_checkins
          where company_id = ? and checkin_id = ?`,
        [options.companyId, row.checkin_id],
      )
    : await options.source.query<SourceKeyResultCheckIn>(
        `select k.key_result_id, k.current_value, k.confidence, k.remarks
           from key_result_checkins k
           join key_results r on r.id = k.key_result_id
          where k.company_id = ? and r.objective_id = ?
            and k.start_date = ? and k.end_date = ?`,
        [options.companyId, row.objective_id, row.start_date, row.end_date],
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
  const reviews = await options.source.query<{
    user_id: number | null;
    created_at: string | null;
  }>(
    `select user_id, created_at from checkin_reviews
      where company_id = ? and checkin_id = ?
      order by created_at limit 1`,
    [options.companyId, row.checkin_id],
  );
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
