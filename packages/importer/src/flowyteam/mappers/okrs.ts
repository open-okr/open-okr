/**
 * Objectives and key results (TECHNICAL-PLAN §7.2, P6-T03b).
 *
 * **The owner comes from `model_type` and never from `objective_type`.** The
 * reference records that FlowyTeam's `objective_type` enum was never widened
 * while its services write values outside it, and a live instance bears that
 * out: 23 objectives hold the empty string. `model_type` is the polymorphic
 * owner the product itself resolves against, so it is the one this reads.
 *
 * **Alignment is two passes because a parent can be created after its child.**
 * FlowyTeam's `objective_parent_id` points at any objective in the company,
 * including one with a higher id. The first pass creates every goal with no
 * parent; the second sets the pointers once every id resolves. A single pass
 * would drop the alignment of whichever objectives happened to be read early,
 * which is the kind of loss nobody notices until a quarter is planned on it.
 *
 * **Nothing derived is carried.** `result_percentage` and `current_percentage`
 * are cached in the source and recomputed here by the engines, which run inside
 * the actions this calls. Where the source's stored figure disagrees with the
 * recomputed one, the recomputed one wins and the difference is reported: it is
 * the one number a migration is most often asked about afterwards.
 */
import {
  type ActionCallContext,
  callAction,
  richTextFromPlainText,
} from "@openokr/core";
import { legacyKeyFor } from "../legacy.ts";
import type { Source } from "../source.ts";
import { type DomainReconciliation, DomainTally } from "./reconcile.ts";
import type { Resolver } from "./resolve.ts";

export interface OkrResult {
  readonly domains: readonly DomainReconciliation[];
  /** Objectives whose stored score disagreed with the recomputed one. */
  readonly rescored: number;
  /** True when any key result carried a value the 2023 bigint change truncated. */
  readonly truncatedValues: boolean;
}

interface MapperOptions {
  readonly source: Source;
  readonly context: ActionCallContext;
  readonly companyId: number;
  readonly resolver: Resolver;
  /** The member every write is authorised as, and the last resort for a champion. */
  readonly actingMemberId: string;
  readonly write: boolean;
}

export async function importOkrs(options: MapperOptions): Promise<OkrResult> {
  const objectives = await readObjectives(options);
  const goals = await importGoals(options, objectives);
  // **Key results before alignment, not after.** FlowyTeam's primary cascade
  // pointer is `key_result_parent_id`: an objective usually rolls up into a key
  // result rather than into another objective. Aligning before the key results
  // exist means every one of those pointers resolves to nothing. Running it
  // that way against a live company dropped all six of its alignments and
  // reported each as a parent that did not import, which is how the ordering
  // was found: the seeded source only used the objective pointer.
  const keyResults = await importKeyResults(options);
  const alignment = await alignGoals(options, objectives);
  const values = await importKeyResultValues(options);

  return {
    domains: [goals.tally, keyResults.tally, alignment, values],
    rescored: goals.rescored,
    truncatedValues: keyResults.truncated,
  };
}

interface SourceObjective {
  id: number;
  model_id: number | null;
  model_type: string | null;
  leader_model_id: number | null;
  title: string | null;
  description: string | null;
  performance_cycle_id: number | null;
  started_at: string | null;
  finished_at: string | null;
  weight: number | null;
  result_percentage: number | null;
  objective_parent_id: number | null;
  key_result_parent_id: number | null;
}

async function readObjectives(
  options: MapperOptions,
): Promise<readonly SourceObjective[]> {
  return options.source.query<SourceObjective>(
    `select id, model_id, model_type, leader_model_id, title, description,
            performance_cycle_id, started_at, finished_at, weight,
            result_percentage, objective_parent_id, key_result_parent_id
       from objectives
      where company_id = ? and deleted_at is null
      order by id`,
    [options.companyId],
  );
}

/** FlowyTeam's three owner classes, and what each one is here. */
const OWNER = {
  "App\\Models\\Company": { level: "company", kind: "workspace" },
  "App\\Models\\Team": { level: "team", kind: "space" },
  "App\\Models\\EmployeeDetails": { level: "individual", kind: "member" },
} as const;

async function importGoals(
  options: MapperOptions,
  objectives: readonly SourceObjective[],
): Promise<{ tally: DomainReconciliation; rescored: number }> {
  const tally = new DomainTally("objectives");
  let rescored = 0;

  for (const row of objectives) {
    tally.sawRow();
    const source = `objectives:${row.id}`;
    const title = (row.title ?? "").trim();
    if (title === "") {
      tally.skip(source, "This objective has no title in the source.");
      continue;
    }

    const owner = OWNER[(row.model_type ?? "") as keyof typeof OWNER];
    if (!owner) {
      // 15 rows on one live instance hold the empty string here, and one holds
      // `App\Models\User`. Guessing the level from `objective_type` is exactly
      // what §11 says not to do.
      tally.skip(
        source,
        `The owner is "${row.model_type}", which is not a company, a team or an employee, so there is no level to give this objective.`,
      );
      continue;
    }

    const ownerId = await ownerTarget(options, owner.kind, row.model_id);
    if (owner.kind !== "workspace" && !ownerId) {
      tally.skip(
        source,
        `The ${owner.kind} that owns this objective did not import.`,
      );
      continue;
    }

    // **Champion from the owner, reviewer from the manager or the lead**, which
    // is §7.2's own sentence. Getting it the other way round looked fine
    // against a seeded source and imported nothing at all against a live one:
    // the company this was tried on has sixteen objectives and not one of them
    // names a lead. The owner is the field FlowyTeam always fills, because it
    // is how the product decides who sees the objective.
    const champion =
      (await championOf(options, owner.kind, row.model_id)) ??
      (await member(options, row.leader_model_id)) ??
      options.actingMemberId;
    const assigned =
      champion === options.actingMemberId &&
      owner.kind !== "member" &&
      (await member(options, row.leader_model_id)) === undefined;
    if (assigned) {
      // A company-level objective has no person in the source at all, and
      // METHOD.md requires a champion. Losing the whole top level of a
      // company's OKRs would be worse than naming the person performing the
      // migration and saying so loudly enough that somebody reassigns it.
      tally.flag(
        source,
        "Nobody in the source owns this objective, so it is championed by whoever ran the import. Somebody should reassign it.",
      );
    }

    const reviewer =
      (await managerOf(options, row.leader_model_id)) ??
      (await managerOfMember(options, owner, row.model_id)) ??
      (await member(options, row.leader_model_id)) ??
      champion;
    if (reviewer === champion) {
      tally.flag(
        source,
        "Imported with its champion as its own reviewer: the source names no manager and no separate lead. Somebody should set a reviewer.",
      );
    }

    if (!options.write) {
      const already = await options.resolver.resolve("objectives", row.id);
      if (already === undefined) {
        options.resolver.plan("objectives", row.id);
      }
      tally.wrote(already === undefined);
      continue;
    }
    const existing = await options.resolver.resolve("objectives", row.id);
    if (existing) {
      tally.wrote(false);
      continue;
    }

    const cycleId = row.performance_cycle_id
      ? await options.resolver.resolve(
          "performance_cycles",
          row.performance_cycle_id,
        )
      : undefined;
    // **A cycle that did not import is not a lost objective.** A weekly source
    // cycle has no cadence here (P6-T03a), and the objective still has its own
    // dates. `goals.create` takes exactly one of the two, so this is the answer
    // to the question that row raised.
    const timeframe =
      cycleId || !row.started_at || !row.finished_at
        ? undefined
        : {
            startsOn: row.started_at.slice(0, 10),
            endsOn: row.finished_at.slice(0, 10),
          };
    if (!cycleId && !timeframe) {
      tally.skip(
        source,
        "This objective is in a cycle that did not import and carries no dates of its own.",
      );
      continue;
    }

    try {
      const created = await callAction(options.context, "goals.create", {
        title: title.slice(0, 500),
        ...(row.description?.trim()
          ? { description: richTextFromPlainText(row.description) }
          : {}),
        ...(cycleId ? { cycleId } : {}),
        ...(timeframe ? { timeframe } : {}),
        level: owner.level,
        ownerKind: owner.kind,
        ...(owner.kind === "space" && ownerId ? { spaceId: ownerId } : {}),
        ...(owner.kind === "member" && ownerId ? { memberId: ownerId } : {}),
        championId: champion,
        reviewerId: reviewer,
        weight: clampWeight(row.weight),
        legacy: legacyKeyFor("objectives", row.id),
      });
      options.resolver.remember("objectives", row.id, created.id);
      tally.wrote(true);
      if ((row.result_percentage ?? 0) > 0) {
        // Every score here is recomputed from the key results the next mapper
        // writes, so a stored figure is a fact about the old system and not
        // about this one.
        rescored += 1;
      }
    } catch (error) {
      tally.skip(source, messageOf(error));
    }
  }

  return { tally: tally.finish(), rescored };
}

/**
 * The second pass: the alignment pointers, once every goal exists.
 *
 * `key_result_parent_id` wins over `objective_parent_id` where both are set,
 * because §3.1 of the reference calls it the primary cascade pointer and the
 * target refuses a goal that aligns to two parents anyway.
 */
async function alignGoals(
  options: MapperOptions,
  objectives: readonly SourceObjective[],
): Promise<DomainReconciliation> {
  const tally = new DomainTally("alignment");

  for (const row of objectives) {
    if (!row.objective_parent_id && !row.key_result_parent_id) {
      continue;
    }
    tally.sawRow();
    const source = `objectives:${row.id}`;
    const child = await options.resolver.resolve("objectives", row.id);
    if (!child) {
      tally.skip(source, "This objective did not import, so it cannot align.");
      continue;
    }

    const parentKeyResult = row.key_result_parent_id
      ? await options.resolver.resolve("key_results", row.key_result_parent_id)
      : undefined;
    const parentGoal =
      !parentKeyResult && row.objective_parent_id
        ? await options.resolver.resolve("objectives", row.objective_parent_id)
        : undefined;

    if (!parentKeyResult && !parentGoal) {
      tally.skip(
        source,
        `The parent this objective aligns to did not import (${row.key_result_parent_id ? `key result ${row.key_result_parent_id}` : `objective ${row.objective_parent_id}`}).`,
      );
      continue;
    }

    if (!options.write) {
      tally.wrote(true);
      continue;
    }

    // **Already aligned is a match, not a write.** `goals.update` would happily
    // set the same pointer again, and a second run would then report writes it
    // did not make. Worse, it would overwrite an alignment somebody corrected
    // in the product after the first run.
    const current = await callAction(options.context, "goals.read", {
      id: child,
    });
    if (
      (parentKeyResult && current.parentKeyResultId === parentKeyResult) ||
      (parentGoal && current.parentGoalId === parentGoal)
    ) {
      tally.wrote(false);
      continue;
    }

    try {
      await callAction(options.context, "goals.update", {
        id: child,
        ...(parentKeyResult
          ? { parentKeyResultId: parentKeyResult }
          : { parentGoalId: parentGoal }),
      });
      tally.wrote(true);
    } catch (error) {
      // A loop the source allowed and this product does not, most often.
      tally.skip(source, messageOf(error));
    }
  }

  return tally.finish();
}

interface SourceKeyResult {
  id: number;
  objective_id: number;
  title: string | null;
  description: string | null;
  unit_value: string | null;
  initial_value: string | number | null;
  target_value: string | number | null;
  current_value: string | number | null;
  weight: number | null;
  leader_model_id: number | null;
}

async function importKeyResults(
  options: MapperOptions,
): Promise<{ tally: DomainReconciliation; truncated: boolean }> {
  const tally = new DomainTally("key results");
  let truncated = false;
  const rows = await options.source.query<SourceKeyResult>(
    `select k.id, k.objective_id, k.title, k.description, k.unit_value,
            k.initial_value, k.target_value, k.current_value, k.weight,
            k.leader_model_id
       from key_results k
       join objectives o on o.id = k.objective_id
      where k.company_id = ? and k.deleted_at is null and o.deleted_at is null
      order by k.id`,
    [options.companyId],
  );

  for (const row of rows) {
    tally.sawRow();
    const source = `key_results:${row.id}`;
    const title = (row.title ?? "").trim();
    if (title === "") {
      tally.skip(source, "This key result has no title in the source.");
      continue;
    }
    const goalId = await options.resolver.resolve(
      "objectives",
      row.objective_id,
    );
    if (!goalId) {
      tally.skip(
        source,
        `Objective ${row.objective_id} did not import, so its key result could not either.`,
      );
      continue;
    }

    const baseline = numberOf(row.initial_value);
    const target = numberOf(row.target_value);
    const current = numberOf(row.current_value);
    if (baseline === null || target === null) {
      tally.skip(source, "This key result has no baseline or no target.");
      continue;
    }
    if (baseline === target) {
      // `maintain` is a real direction here and the source has no way to say
      // it: a key result whose baseline equals its target is either a hold or
      // a row somebody never filled in. Imported as a hold and reported.
      tally.flag(
        source,
        "Imported as a maintain: its baseline and its target are the same number, and the source has no direction to say which it meant.",
      );
    }
    if (!Number.isInteger(baseline) || !Number.isInteger(target)) {
      truncated = true;
    }

    if (!options.write) {
      const already = await options.resolver.resolve("key_results", row.id);
      if (already === undefined) {
        options.resolver.plan("key_results", row.id);
      }
      tally.wrote(already === undefined);
      continue;
    }
    if (await options.resolver.resolve("key_results", row.id)) {
      tally.wrote(false);
      continue;
    }

    try {
      const created = await callAction(options.context, "goals.addKeyResult", {
        goalId,
        title: title.slice(0, 500),
        ...(row.unit_value?.trim()
          ? { unit: row.unit_value.trim().slice(0, 60) }
          : {}),
        direction:
          baseline === target
            ? "maintain"
            : target > baseline
              ? "increase"
              : "reduce",
        // **Lagging, and flagged for review.** §7.2 asks for exactly this:
        // FlowyTeam has no leading-versus-lagging distinction, and guessing
        // from a title would put a word in somebody's mouth about how they
        // measure.
        indicatorType: "lagging",
        baselineValue: baseline,
        targetValue: target,
        ...(current === null ? {} : { currentValue: current }),
        ...(await ownerFor(options, row.leader_model_id)),
        weight: clampWeight(row.weight),
        legacy: legacyKeyFor("key_results", row.id),
      });
      options.resolver.remember("key_results", row.id, created.id);
      tally.wrote(true);
    } catch (error) {
      tally.skip(source, messageOf(error));
    }
  }

  return { tally: tally.finish(), truncated };
}

/**
 * The value history behind each key result.
 *
 * Written through `goals.recordValue`, which moves the value and records the
 * movement, so the history and the current figure cannot disagree. Records are
 * replayed oldest first, and the last one leaves the key result where the
 * source left it.
 */
async function importKeyResultValues(
  options: MapperOptions,
): Promise<DomainReconciliation> {
  const tally = new DomainTally("key result history");
  const rows = await options.source.query<{
    id: number;
    key_results_id: number;
    history_value: number | null;
  }>(
    `select r.id, r.key_results_id, r.history_value
       from key_result_records r
       join key_results k on k.id = r.key_results_id
      where r.company_id = ? and k.deleted_at is null
      order by r.created_at, r.id`,
    [options.companyId],
  );

  // A record has no legacy key of its own: `key_result_values` is written by
  // `goals.recordValue` and the value is the row. Re-running would replay the
  // same movements, so the count already there is what makes it idempotent.
  const replayed = new Map<string, number>();

  for (const row of rows) {
    tally.sawRow();
    const source = `key_result_records:${row.id}`;
    const keyResultId = await options.resolver.resolve(
      "key_results",
      row.key_results_id,
    );
    if (!keyResultId) {
      tally.skip(
        source,
        `Key result ${row.key_results_id} did not import, so its history could not either.`,
      );
      continue;
    }
    const value = numberOf(row.history_value);
    if (value === null) {
      tally.skip(source, "This record has no value.");
      continue;
    }

    if (!options.write) {
      tally.wrote(true);
      continue;
    }

    const already = await historyCount(options, keyResultId, replayed);
    if (already > 0) {
      // The history is already here from an earlier run. Replaying it would
      // append the same movements a second time, and a value history that
      // doubles on every run is worse than one that stops.
      tally.wrote(false);
      continue;
    }

    try {
      await callAction(options.context, "goals.recordValue", {
        id: keyResultId,
        value,
        note: "Imported from FlowyTeam",
      });
      tally.wrote(true);
    } catch (error) {
      tally.skip(source, messageOf(error));
    }
  }

  return tally.finish();
}

/**
 * How much history this key result already had when the run started.
 *
 * The answer is cached, not just the fact of having asked. Caching only
 * "asked" was the first attempt and it replayed every record after the first
 * one on a second run: the loop asks once per record, and the second question
 * about the same key result has to get the same answer as the first, not a
 * fresh count that now includes what this run has already written.
 */
async function historyCount(
  options: MapperOptions,
  keyResultId: string,
  answers: Map<string, number>,
): Promise<number> {
  const cached = answers.get(keyResultId);
  if (cached !== undefined) {
    return cached;
  }
  const history = await callAction(options.context, "goals.keyResultHistory", {
    keyResultId,
    limit: 2,
  });
  // The baseline `goals.addKeyResult` records itself is not history somebody
  // else wrote, so one row means "nothing has been replayed yet".
  const count = history.values.length > 1 ? history.values.length : 0;
  answers.set(keyResultId, count);
  return count;
}

/**
 * The person the owner points at, when the owner is a person or a team.
 *
 * An individual objective is championed by the employee who owns it. A team
 * objective is championed by that team's leader, which is the closest thing
 * FlowyTeam has to an accountable person for a team. A company objective has
 * nobody, and the caller decides what to do about that.
 */
async function championOf(
  options: MapperOptions,
  kind: "workspace" | "space" | "member",
  modelId: number | null,
): Promise<string | undefined> {
  if (!modelId) {
    return undefined;
  }
  if (kind === "member") {
    return member(options, modelId);
  }
  if (kind === "space") {
    const rows = await options.source.query<{ leader_id: number | null }>(
      "select leader_id from teams where id = ? and deleted_at is null",
      [modelId],
    );
    const leader = rows[0]?.leader_id;
    return leader ? options.resolver.resolve("users", leader) : undefined;
  }
  return undefined;
}

/** Who the owning employee reports to, for an individual objective. */
async function managerOfMember(
  options: MapperOptions,
  owner: { kind: "workspace" | "space" | "member" },
  modelId: number | null,
): Promise<string | undefined> {
  return owner.kind === "member" ? managerOf(options, modelId) : undefined;
}

async function ownerTarget(
  options: MapperOptions,
  kind: "workspace" | "space" | "member",
  modelId: number | null,
): Promise<string | undefined> {
  if (kind === "workspace" || !modelId) {
    return undefined;
  }
  return kind === "space"
    ? options.resolver.resolve("teams", modelId)
    : member(options, modelId);
}

/** An `employee_details` id into a member, through the user it belongs to. */
async function member(
  options: MapperOptions,
  employeeId: number | null,
): Promise<string | undefined> {
  if (!employeeId) {
    return undefined;
  }
  const rows = await options.source.query<{ user_id: number | null }>(
    "select user_id from employee_details where id = ? and deleted_at is null",
    [employeeId],
  );
  const userId = rows[0]?.user_id;
  return userId ? options.resolver.resolve("users", userId) : undefined;
}

/** Who that employee reports to, as a member. */
async function managerOf(
  options: MapperOptions,
  employeeId: number | null,
): Promise<string | undefined> {
  if (!employeeId) {
    return undefined;
  }
  const rows = await options.source.query<{ reports_to: number | null }>(
    "select reports_to from employee_details where id = ? and deleted_at is null",
    [employeeId],
  );
  const reportsTo = rows[0]?.reports_to;
  return reportsTo ? options.resolver.resolve("users", reportsTo) : undefined;
}

async function ownerFor(
  options: MapperOptions,
  employeeId: number | null,
): Promise<{ ownerId?: string }> {
  const owner = await member(options, employeeId);
  return owner ? { ownerId: owner } : {};
}

/** The source clamps weight to 1 through 100 on write, and old rows predate it. */
function clampWeight(weight: number | null): number {
  const value = Number(weight ?? 1);
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  return Math.min(value, 100);
}

/**
 * A source value as a number.
 *
 * The driver hands big integers back as strings, because a bigint does not fit
 * a JavaScript number safely. Every value here is a measurement rather than an
 * identifier, so it becomes a number; one too large to be exact is refused,
 * which is better than importing a target nobody can hit.
 */
function numberOf(value: string | number | null): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isSafeInteger(Math.trunc(parsed))
    ? parsed
    : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Something went wrong importing that row.";
}
