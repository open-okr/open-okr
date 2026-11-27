/**
 * Indicators into KPIs (TECHNICAL-PLAN §7.2, P6-T03d).
 *
 * **FlowyTeam calls this an indicator and has no `Kpi` model at all**, which is
 * the one rename in this whole mapping that changes what a reader has to look
 * for in the source. Categories are `indicator_types`, values are
 * `indicator_records`, and the formula edges are `indicator_calculates`.
 *
 * **Parents before children, in one pass over an ordered read.** An indicator's
 * `indicator_parent_id` points at another indicator, and the target refuses a
 * parent that does not exist yet. Reading in id order is not enough, so the
 * rows are ordered by depth before they are written.
 *
 * **Two things the source does not have, defaulted and flagged.** There is no
 * leading-versus-lagging distinction and no tier, so every imported KPI is a
 * lagging output and every one is flagged for review. Guessing either from a
 * title would put a word in somebody's mouth about how they measure.
 *
 * **`kpi_trees` stays empty on purpose.** FlowyTeam has no named driver tree,
 * and building one from the parent chain would name something nobody chose.
 */

import {
  cascadeOrder,
  type DependencyEdge,
  foldAggregate,
  type KpiAggregate,
  type KpiFrequency,
  normalisePeriod,
} from "@openokr/method";
import type { ActionCallContext } from "../../../actions/define.ts";
import { callAction } from "../../../actions/registry.ts";
import { legacyIdFor, legacyKeyFor } from "../legacy.ts";
import type { Source } from "../source.ts";
import {
  type ParsedFormula,
  parseFormulaTokens,
  resolveFormulaReferences,
} from "./formula.ts";
import { type DomainReconciliation, DomainTally } from "./reconcile.ts";
import type { Resolver } from "./resolve.ts";
import { withWorkspaceQuery } from "./workspace-query.ts";

export interface KpiResult {
  readonly domains: readonly DomainReconciliation[];
}

interface MapperOptions {
  /** What people see for the source system (`imports.flowyteam.displayName`). */
  readonly sourceName: string;
  readonly source: Source;
  readonly context: ActionCallContext;
  readonly companyId: number;
  readonly resolver: Resolver;
  readonly actingMemberId: string;
  readonly write: boolean;
}

export async function importKpis(options: MapperOptions): Promise<KpiResult> {
  const categories = await importCategories(options);
  const indicators = await importIndicators(options);
  // **The formulas are decided before the records are written.** A calculated
  // KPI's values are derived, so its typed source values are never written:
  // `kpis.record` refuses them once the formula is on, and writing them first
  // made the first run store values the second run then refused. Deciding
  // which KPIs will be calculated up front lets both runs, and the dry run,
  // say the same thing about the same rows.
  const plan = await planFormulas(options);
  const records = await importRecords(options, plan);
  const formulas = await importFormulas(options, plan);

  return { domains: [categories, indicators, records, formulas] };
}

async function importCategories(
  options: MapperOptions,
): Promise<DomainReconciliation> {
  const tally = new DomainTally("KPI categories");
  const rows = await options.source.read<{ id: number; name: string | null }>(
    "kpis.categories",
    [],
    options.companyId,
  );

  for (const row of rows) {
    tally.sawRow();
    const source = `indicator_types:${row.id}`;
    const name = (row.name ?? "").trim();
    if (name === "") {
      tally.skip(source, "This category has no name in the source.");
      continue;
    }
    if (!options.write) {
      const already = await options.resolver.resolve("indicator_types", row.id);
      if (already === undefined) {
        options.resolver.plan("indicator_types", row.id);
      }
      tally.wrote(already === undefined);
      continue;
    }
    if (await options.resolver.resolve("indicator_types", row.id)) {
      tally.wrote(false);
      continue;
    }
    try {
      const created = await callAction(options.context, "kpis.createCategory", {
        name: name.slice(0, 120),
        legacy: legacyKeyFor("indicator_types", row.id),
      });
      options.resolver.remember("indicator_types", row.id, created.id);
      tally.wrote(true);
    } catch (error) {
      tally.skip(source, messageOf(error));
    }
  }

  return tally.finish();
}

interface SourceIndicator {
  id: number;
  indicator_type_id: number | null;
  title: string | null;
  description: string | null;
  occurance: string | null;
  direction: string | null;
  aggregate: string | null;
  unit_value: string | null;
  indicator_parent_id: number | null;
  target_value: string | number | null;
  model_id: number | null;
  model_type: string | null;
}

/** FlowyTeam's owner classes, the same three the objectives mapper reads. */
const OWNER = {
  "App\\Models\\Company": "workspace",
  "App\\Models\\Team": "space",
  "App\\Models\\EmployeeDetails": "member",
} as const;

const FREQUENCY = new Set([
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
]);
const AGGREGATE = new Set(["sum", "avg", "max", "min", "count"]);

async function importIndicators(
  options: MapperOptions,
): Promise<DomainReconciliation> {
  const tally = new DomainTally("KPIs");
  const rows = await options.source.read<SourceIndicator>(
    "kpis.indicators",
    [],
    options.companyId,
  );

  // **Depth order, not id order.** A child can have a lower id than its parent,
  // and `kpis.create` refuses a parent that is not there yet.
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = [...rows].sort((a, b) => depthOf(a, byId) - depthOf(b, byId));

  for (const row of ordered) {
    tally.sawRow();
    const source = `indicators:${row.id}`;
    const title = (row.title ?? "").trim();
    if (title === "") {
      tally.skip(source, "This indicator has no title in the source.");
      continue;
    }

    const frequency = (row.occurance ?? "").toLowerCase();
    if (!FREQUENCY.has(frequency)) {
      tally.skip(
        source,
        `This indicator is recorded "${row.occurance}", which is not a frequency this product measures on.`,
      );
      continue;
    }

    const kind = OWNER[(row.model_type ?? "") as keyof typeof OWNER];
    const ownerId =
      kind === "space"
        ? await options.resolver.resolve("teams", row.model_id ?? 0)
        : kind === "member"
          ? await memberOf(options, row.model_id)
          : undefined;
    // **An owner the source no longer holds is not an owner that failed.**
    // FlowyTeam hard-deletes teams and employee rows and leaves their KPIs
    // pointing at nothing, so there is nobody to give them to. They import at
    // workspace level, each one named in the report. An owner that is still
    // there and did not import for another reason keeps the skip.
    let orphaned = false;
    if (kind && kind !== "workspace" && !ownerId) {
      if (!(await ownerGone(options, kind, row.model_id))) {
        tally.skip(
          source,
          `The ${kind} that owns this indicator did not import.`,
        );
        continue;
      }
      orphaned = true;
    }
    const orphanNote = `The ${kind === "space" ? "team" : "employee"} that owned this indicator no longer exists in ${options.sourceName}, so it is imported at workspace level.`;

    if (!options.write) {
      const already = await options.resolver.resolve("indicators", row.id);
      if (already === undefined) {
        options.resolver.plan("indicators", row.id);
        if (orphaned) {
          tally.flag(source, orphanNote);
        }
      }
      tally.wrote(already === undefined);
      continue;
    }
    if (await options.resolver.resolve("indicators", row.id)) {
      tally.wrote(false);
      continue;
    }

    const categoryId = row.indicator_type_id
      ? await options.resolver.resolve("indicator_types", row.indicator_type_id)
      : undefined;
    const parentKpiId = row.indicator_parent_id
      ? await options.resolver.resolve("indicators", row.indicator_parent_id)
      : undefined;
    if (row.indicator_parent_id && !parentKpiId) {
      tally.flag(
        source,
        `Imported without its parent: indicator ${row.indicator_parent_id} did not import.`,
      );
    }
    if ((row.direction ?? "").toLowerCase() === "none") {
      tally.flag(
        source,
        "The source says this indicator has no direction, so it is imported as higher-is-better. Somebody should check it.",
      );
    }

    const target = Number(row.target_value ?? Number.NaN);

    try {
      const created = await callAction(options.context, "kpis.create", {
        title: title.slice(0, 500),
        frequency: frequency as
          | "daily"
          | "weekly"
          | "monthly"
          | "quarterly"
          | "yearly",
        direction:
          (row.direction ?? "").toLowerCase() === "down"
            ? "lower_better"
            : "higher_better",
        // Neither exists in the source. Every imported KPI is flagged below so
        // that a reader knows the value is a default and not a decision.
        indicatorType: "lagging",
        tier: "output",
        aggregate: AGGREGATE.has((row.aggregate ?? "").toLowerCase())
          ? ((row.aggregate ?? "sum").toLowerCase() as
              | "sum"
              | "avg"
              | "max"
              | "min"
              | "count")
          : "sum",
        ownerKind: (orphaned ? "workspace" : (kind ?? "workspace")) as
          | "workspace"
          | "space"
          | "member",
        ...(kind === "space" && ownerId ? { spaceId: ownerId } : {}),
        ...(kind === "member" && ownerId ? { memberId: ownerId } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(parentKpiId ? { parentKpiId } : {}),
        ...(row.unit_value?.trim()
          ? { unit: row.unit_value.trim().slice(0, 60) }
          : {}),
        ...(Number.isFinite(target) ? { targetDefault: target } : {}),
        legacy: legacyKeyFor("indicators", row.id),
      });
      options.resolver.remember("indicators", row.id, created.id);
      tally.wrote(true);
      if (orphaned) {
        tally.flag(source, orphanNote);
      }
      tally.flag(
        source,
        `Imported as a lagging output measure. ${options.sourceName} records neither the leading-versus-lagging distinction nor a tier, so both are defaults rather than decisions.`,
      );
    } catch (error) {
      tally.skip(source, messageOf(error));
    }
  }

  return tally.finish();
}

/** How many indicators deep this one sits, counting itself as one. */
function depthOf(
  indicator: SourceIndicator,
  byId: ReadonlyMap<number, SourceIndicator>,
): number {
  let depth = 1;
  const seen = new Set<number>([indicator.id]);
  let current = indicator;
  while (current.indicator_parent_id !== null) {
    const parent = byId.get(current.indicator_parent_id);
    if (!parent || seen.has(parent.id)) {
      break;
    }
    seen.add(parent.id);
    current = parent;
    depth += 1;
  }
  return depth;
}

/** What a dry run resolves to, as `resolve.ts` plans it. */
const PLANNED = "planned-by-a-dry-run";

/** One calculated indicator, and whether its formula will be stored. */
interface FormulaPlanEntry {
  readonly id: number;
  readonly text: string;
  readonly kpiId: string | undefined;
  /** Set when the formula will be stored; otherwise `reason` says why not. */
  readonly tree?: ParsedFormula;
  readonly references: readonly number[];
  readonly reason?: string;
}

interface FormulaPlan {
  /** Every calculated indicator the source holds, in id order. */
  readonly entries: readonly FormulaPlanEntry[];
  /** The indicators whose formula will be stored: their values are derived. */
  readonly calculated: ReadonlySet<number>;
  /** How many typed source values each calculated indicator held. */
  readonly recomputed: Map<number, number>;
}

/**
 * Which formulas will be stored, decided before anything is written.
 *
 * **A cycle is refused here the way `kpis.setFormula` refuses it**, by the
 * same `cascadeOrder` over the edges as they would stand, in id order. Doing
 * it here rather than waiting for the action to throw is what lets the dry run
 * name the same formulas, and lets the record step know which KPIs will be
 * calculated before it writes their values.
 */
async function planFormulas(options: MapperOptions): Promise<FormulaPlan> {
  const rows = await options.source.read<{
    id: number;
    calculated_value: string | null;
  }>("kpis.formulas", [], options.companyId);

  const entries: FormulaPlanEntry[] = [];
  const edges: DependencyEdge[] = [];
  for (const row of rows) {
    const text = row.calculated_value ?? "";
    const kpiId = await options.resolver.resolve("indicators", row.id);
    if (!kpiId) {
      entries.push({
        id: row.id,
        text,
        kpiId,
        references: [],
        reason: "This indicator did not import, so nor did its formula.",
      });
      continue;
    }

    const parsed = parseFormulaTokens(text);
    if (!parsed.ok) {
      entries.push({
        id: row.id,
        text,
        kpiId,
        references: [],
        reason: `The formula "${text.slice(0, 120)}" was dropped: ${parsed.reason}. The KPI imported with its recorded values and no calculation.`,
      });
      continue;
    }

    const targets = new Map<number, string>();
    for (const reference of parsed.references) {
      const target = await options.resolver.resolve("indicators", reference);
      if (target) {
        targets.set(reference, target);
      }
    }
    const resolved = resolveFormulaReferences(parsed.tree, targets);
    if (!resolved.ok) {
      entries.push({
        id: row.id,
        text,
        kpiId,
        references: parsed.references,
        reason: `The formula was dropped: it references indicator ${resolved.missing.join(", ")}, which did not import. The KPI imported with its recorded values and no calculation.`,
      });
      continue;
    }

    const proposed = [
      ...edges,
      ...parsed.references.map((reference) => ({
        dependent: String(row.id),
        dependsOn: String(reference),
      })),
    ];
    if (cascadeOrder(proposed, String(row.id)).rejected) {
      entries.push({
        id: row.id,
        text,
        kpiId,
        references: parsed.references,
        reason:
          "The formula was dropped: it would make a cycle, this KPI ending up calculated from itself through another one. The KPI imported with its recorded values and no calculation.",
      });
      continue;
    }
    edges.splice(0, edges.length, ...proposed);
    entries.push({
      id: row.id,
      text,
      kpiId,
      tree: resolved.tree,
      references: parsed.references,
    });
  }

  return {
    entries,
    calculated: new Set(
      entries.filter((entry) => entry.tree).map((entry) => entry.id),
    ),
    recomputed: new Map(),
  };
}

interface SourceRecord {
  id: number;
  indicator_id: number;
  period_key: string | null;
  current_value: number | null;
  target_value: number | null;
  remark: string | null;
  occurance: string | null;
  aggregate: string | null;
}

/**
 * The recorded values, one per KPI per period.
 *
 * **Each record carries `indicator_records:<id>` as its legacy key**, so a
 * second run finds it and writes nothing. A workspace imported before records
 * carried a key is matched on the KPI and the period instead, and `kpis.record`
 * fills the key in on that row rather than adding a second one.
 *
 * **Several source records in one period are one value.** FlowyTeam keeps a
 * record per date, so a weekly KPI can hold four in one week and a daily one
 * two on one day. The product holds one value per period, so they are folded
 * by the KPI's own aggregate (the fold the formula engine uses for a finer
 * source), written once under the lowest source id, and each combination is
 * named in the report with every id, the period and the value.
 *
 * **A calculated KPI's typed values are not written.** Its value is derived,
 * so it is recomputed from the formula; the report names each KPI once with
 * how many source values that was.
 */
async function importRecords(
  options: MapperOptions,
  plan: FormulaPlan,
): Promise<DomainReconciliation> {
  const tally = new DomainTally("KPI records");
  const rows = await options.source.read<SourceRecord>(
    "kpis.records",
    [],
    options.companyId,
  );

  // What earlier runs wrote, read once. By key, and by KPI and period for a
  // workspace imported before records carried one.
  const existing = await withWorkspaceQuery<{
    kpi_id: string;
    period: string;
    legacy_id: string | null;
  }>(
    options.context.pool,
    options.context.workspaceId,
    `select r.kpi_id, to_char(r.period_start, 'YYYY-MM-DD') as period,
            r.legacy_id
       from kpi_records r
       join kpis k on k.id = r.kpi_id
      where r.workspace_id = $1 and r.deleted_at is null
        and k.legacy_type = 'flowyteam'`,
    [options.context.workspaceId],
  );
  const byKey = new Set(
    existing.flatMap((row) => (row.legacy_id ? [row.legacy_id] : [])),
  );
  const byPeriod = new Set(
    existing.map((row) => `${row.kpi_id}|${row.period}`),
  );

  const groups = new Map<
    string,
    { kpiId: string; period: string; rows: SourceRecord[] }
  >();
  for (const row of rows) {
    tally.sawRow();
    const source = `indicator_records:${row.id}`;
    const kpiId = await options.resolver.resolve(
      "indicators",
      row.indicator_id,
    );
    if (!kpiId) {
      tally.skip(
        source,
        `Indicator ${row.indicator_id} did not import, so its records could not either.`,
      );
      continue;
    }
    if (!row.period_key) {
      tally.skip(source, "This record has no period in the source.");
      continue;
    }
    if (plan.calculated.has(row.indicator_id)) {
      tally.recomputedHere();
      plan.recomputed.set(
        row.indicator_id,
        (plan.recomputed.get(row.indicator_id) ?? 0) + 1,
      );
      continue;
    }

    // The action normalises the date too; doing it here is what finds two
    // records that land in one period before either is written.
    const period = normalisePeriod(
      (row.occurance ?? "").toLowerCase() as KpiFrequency,
      String(row.period_key).slice(0, 10),
    );
    const key = `${row.indicator_id}|${period}`;
    const group = groups.get(key);
    if (group) {
      group.rows.push(row);
    } else {
      groups.set(key, { kpiId, period, rows: [row] });
    }
  }

  for (const [indicatorId, count] of plan.recomputed) {
    tally.flag(
      `indicators:${indicatorId}`,
      `Calculated KPI: its ${count} recorded value(s) in ${options.sourceName} were not imported, because the value is recomputed from the formula.`,
    );
  }

  for (const group of groups.values()) {
    const first = group.rows.reduce((low, row) =>
      row.id < low.id ? row : low,
    );
    const others = group.rows.filter((row) => row !== first);
    const aggregate = aggregateOf(first.aggregate);
    const value = combine(
      aggregate,
      group.rows.map((row) => numberOr(row.current_value)),
    );
    const target = combineTargets(
      aggregate,
      group.rows.map((row) => numberOr(row.target_value)),
    );
    const remark = [
      ...new Set(
        group.rows.flatMap((row) =>
          row.remark?.trim() ? [row.remark.trim()] : [],
        ),
      ),
    ]
      .join(" / ")
      .slice(0, 500);
    const legacyId = legacyIdFor("indicator_records", first.id);
    const source = `indicator_records:${first.id}`;
    const combination =
      others.length > 0
        ? `Combined with ${others.map((row) => `indicator_records:${row.id}`).join(", ")} into one ${(first.occurance ?? "").toLowerCase()} record for the period starting ${group.period}, by ${aggregate}: ${value ?? "no value"}.`
        : null;

    if (!options.write) {
      const already =
        group.kpiId !== PLANNED &&
        (byKey.has(legacyId) || byPeriod.has(`${group.kpiId}|${group.period}`));
      tally.wrote(!already);
      tally.combinedInto(others.length);
      if (combination) {
        tally.flag(source, combination);
      }
      continue;
    }

    if (byKey.has(legacyId)) {
      // Already stored is a match, not a write: recording it again would
      // overwrite a value somebody corrected in the product since.
      tally.wrote(false);
      tally.combinedInto(others.length);
      if (combination) {
        tally.flag(source, combination);
      }
      continue;
    }
    try {
      const written = await callAction(options.context, "kpis.record", {
        kpiId: group.kpiId,
        on: group.period,
        actualValue: value,
        targetValue: target,
        ...(remark ? { remark } : {}),
        legacy: legacyKeyFor("indicator_records", first.id),
      });
      tally.wrote(written.created);
      tally.combinedInto(others.length);
      if (combination) {
        tally.flag(source, combination);
      }
    } catch (error) {
      for (const row of group.rows) {
        tally.skip(`indicator_records:${row.id}`, messageOf(error));
      }
    }
  }

  return tally.finish();
}

/** The aggregate the KPI was created with, as `importIndicators` maps it. */
function aggregateOf(value: string | null): KpiAggregate {
  const lower = (value ?? "").toLowerCase();
  return AGGREGATE.has(lower) ? (lower as KpiAggregate) : "sum";
}

/** Values of one period in period order, folded; null when none has a value. */
function combine(
  aggregate: KpiAggregate,
  values: readonly (number | null)[],
): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) {
    return null;
  }
  return present.length === 1 && values.length === 1
    ? (present[0] ?? null)
    : foldAggregate(aggregate, present);
}

/**
 * The target of one period. One target shared by every record is that target;
 * only records that disagree are folded, by the same aggregate as the value.
 */
function combineTargets(
  aggregate: KpiAggregate,
  values: readonly (number | null)[],
): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) {
    return null;
  }
  return present.every((value) => value === present[0])
    ? (present[0] ?? null)
    : foldAggregate(aggregate, present);
}

/**
 * The calculated indicators, translated into the expression tree.
 *
 * Runs last, because a formula references other KPIs and their records have
 * to be there first. Stored in dependency order, so a formula over another
 * calculated KPI is evaluated after that one has values.
 */
async function importFormulas(
  options: MapperOptions,
  plan: FormulaPlan,
): Promise<DomainReconciliation> {
  const tally = new DomainTally("KPI formulas");

  for (const entry of plan.entries) {
    tally.sawRow();
    if (!entry.tree) {
      tally.skip(
        `indicators:${entry.id}`,
        entry.reason ?? "The formula was dropped.",
      );
    }
  }

  for (const entry of dependencyOrder(plan)) {
    const source = `indicators:${entry.id}`;
    const kpiId = entry.kpiId as string;
    const tree = entry.tree as ParsedFormula;

    // **Already stored is a match, not a write.** `kpis.setFormula` replaces
    // the edges and re-evaluates whether or not anything changed, so calling it
    // blind would make every re-run report writes it did not make and would
    // overwrite a formula somebody corrected in the product afterwards. The dry
    // run asks the same question, so it counts what the write would.
    if (kpiId !== PLANNED) {
      const detail = await callAction(options.context, "kpis.detail", {
        kpiId,
        periods: 1,
      });
      if (
        detail.kpi.formula &&
        canonical(detail.kpi.formula) === canonical(tree)
      ) {
        tally.wrote(false);
        continue;
      }
    }
    if (!options.write) {
      tally.wrote(true);
      continue;
    }

    // **Evaluated for every period its references have data in, not just one.**
    // `kpis.setFormula` evaluates the period it is given, which is right for a
    // person setting a formula today and wrong for an import: the values it is
    // calculated from are last year's. Evaluating only today would store the
    // formula and leave every historical period empty, which is exactly the
    // history somebody migrates to keep.
    const periods = await periodsOf(options, entry.references);
    try {
      for (const on of periods) {
        await callAction(options.context, "kpis.setFormula", {
          kpiId,
          formula: tree,
          on,
        });
      }
      tally.wrote(true);
    } catch (error) {
      const lost = plan.recomputed.get(entry.id) ?? 0;
      tally.skip(
        source,
        `The formula was dropped: ${messageOf(error)}${lost > 0 ? ` Its ${lost} recorded value(s) were not imported either, because they were set aside for the calculation.` : ""}`,
      );
    }
  }

  return tally.finish();
}

/** The formulas to store, each after every calculated KPI it reads. */
function dependencyOrder(plan: FormulaPlan): FormulaPlanEntry[] {
  const stored = new Map(
    plan.entries
      .filter((entry) => entry.tree)
      .map((entry) => [entry.id, entry]),
  );
  const ordered: FormulaPlanEntry[] = [];
  const done = new Set<number>();
  const visit = (entry: FormulaPlanEntry): void => {
    if (done.has(entry.id)) {
      return;
    }
    done.add(entry.id);
    for (const reference of entry.references) {
      const inner = stored.get(reference);
      if (inner) {
        visit(inner);
      }
    }
    ordered.push(entry);
  };
  for (const entry of stored.values()) {
    visit(entry);
  }
  return ordered;
}

/**
 * Every period the referenced indicators hold a record in, oldest first.
 *
 * Today is included at the end, so a formula over KPIs with no records at all
 * still gets stored and evaluated once rather than silently doing nothing.
 */
async function periodsOf(
  options: MapperOptions,
  references: readonly number[],
): Promise<readonly string[]> {
  if (references.length === 0) {
    return [new Date().toISOString().slice(0, 10)];
  }
  const rows = await options.source.read<{ period_key: string | null }>(
    "kpis.recordPeriods",
    [references],
    options.companyId,
  );
  const periods = rows
    .map((row) => (row.period_key ? String(row.period_key).slice(0, 10) : null))
    .filter((period): period is string => period !== null);
  return periods.length > 0 ? periods : [new Date().toISOString().slice(0, 10)];
}

/**
 * A tree as a string that does not depend on key order.
 *
 * Postgres normalises jsonb key order, so the formula that comes back out is
 * the same tree written differently and a plain `JSON.stringify` comparison
 * says it changed. That made every second run re-store an identical formula and
 * report a write it had not made.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Whether the row that owned an indicator is gone from the source altogether.
 *
 * Gone means no row at all, deleted or not. A soft-deleted owner is still
 * there, and so is one that belongs to another company: both keep the skip,
 * because somebody can still say who they were.
 */
async function ownerGone(
  options: MapperOptions,
  kind: "space" | "member",
  modelId: number | null,
): Promise<boolean> {
  if (!modelId) {
    return true;
  }
  const rows = await options.source.read<{ id: number }>(
    kind === "space" ? "kpis.ownerSpaceExists" : "kpis.ownerMemberExists",
    [modelId],
  );
  return rows.length === 0;
}

/** An `employee_details` id into a member, through the user it belongs to. */
async function memberOf(
  options: MapperOptions,
  employeeId: number | null,
): Promise<string | undefined> {
  if (!employeeId) {
    return undefined;
  }
  const rows = await options.source.read<{ user_id: number | null }>(
    "organisation.employeeUser",
    [employeeId],
    options.companyId,
  );
  const userId = rows[0]?.user_id;
  return userId ? options.resolver.resolve("users", userId) : undefined;
}

function numberOr(value: number | null): number | null {
  const parsed = Number(value ?? Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Something went wrong importing that indicator.";
}
