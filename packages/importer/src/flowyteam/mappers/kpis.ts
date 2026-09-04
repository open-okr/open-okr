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
import { type ActionCallContext, callAction } from "@openokr/core";
import { legacyKeyFor } from "../legacy.ts";
import type { Source } from "../source.ts";
import { parseFormulaTokens, resolveFormulaReferences } from "./formula.ts";
import { type DomainReconciliation, DomainTally } from "./reconcile.ts";
import type { Resolver } from "./resolve.ts";

export interface KpiResult {
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

export async function importKpis(options: MapperOptions): Promise<KpiResult> {
  const categories = await importCategories(options);
  const indicators = await importIndicators(options);
  const records = await importRecords(options);
  const formulas = await importFormulas(options);

  return { domains: [categories, indicators, records, formulas] };
}

async function importCategories(
  options: MapperOptions,
): Promise<DomainReconciliation> {
  const tally = new DomainTally("KPI categories");
  const rows = await options.source.query<{ id: number; name: string | null }>(
    `select id, name from indicator_types
      where company_id = ? and deleted_at is null order by id`,
    [options.companyId],
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
  const rows = await options.source.query<SourceIndicator>(
    `select id, indicator_type_id, title, description, occurance, direction,
            aggregate, unit_value, indicator_parent_id, target_value,
            model_id, model_type
       from indicators
      where company_id = ? and deleted_at is null
      order by id`,
    [options.companyId],
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
    if (kind && kind !== "workspace" && !ownerId) {
      tally.skip(
        source,
        `The ${kind} that owns this indicator did not import.`,
      );
      continue;
    }

    if (!options.write) {
      const already = await options.resolver.resolve("indicators", row.id);
      if (already === undefined) {
        options.resolver.plan("indicators", row.id);
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
        ownerKind: (kind ?? "workspace") as "workspace" | "space" | "member",
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
      tally.flag(
        source,
        "Imported as a lagging output measure. FlowyTeam records neither the leading-versus-lagging distinction nor a tier, so both are defaults rather than decisions.",
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

/**
 * The recorded values, one per KPI per period.
 *
 * `kpis.record` is an upsert on the period, which is why `indicator_records`
 * carries no legacy key: re-running writes each period once whatever identifier
 * the source used, and a second identity could only disagree with the first
 * (P6-T01a settled that for the spreadsheet importer and it holds here).
 */
async function importRecords(
  options: MapperOptions,
): Promise<DomainReconciliation> {
  const tally = new DomainTally("KPI records");
  const rows = await options.source.query<{
    id: number;
    indicator_id: number;
    period_key: string | null;
    current_value: number | null;
    target_value: number | null;
    remark: string | null;
  }>(
    `select r.id, r.indicator_id, r.period_key, r.current_value, r.target_value,
            r.remark
       from indicator_records r
       join indicators i on i.id = r.indicator_id
      where r.company_id = ? and r.deleted_at is null and i.deleted_at is null
      order by r.period_key, r.id`,
    [options.companyId],
  );

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

    if (!options.write) {
      tally.wrote(true);
      continue;
    }
    try {
      const written = await callAction(options.context, "kpis.record", {
        kpiId,
        // The period key is a date in the source and the action normalises it
        // to the KPI's own period, so a monthly KPI recorded on the 14th lands
        // in that month rather than on that day.
        on: String(row.period_key).slice(0, 10),
        actualValue: numberOr(row.current_value),
        targetValue: numberOr(row.target_value),
        ...(row.remark?.trim()
          ? { remark: row.remark.trim().slice(0, 500) }
          : {}),
      });
      tally.wrote(written.created);
    } catch (error) {
      tally.skip(source, messageOf(error));
    }
  }

  return tally.finish();
}

/**
 * The calculated indicators, translated into the expression tree.
 *
 * Runs last, because a formula references other KPIs and every one of them has
 * to exist first. An unparseable formula is dropped with its reason and the KPI
 * keeps whatever values it recorded.
 */
async function importFormulas(
  options: MapperOptions,
): Promise<DomainReconciliation> {
  const tally = new DomainTally("KPI formulas");
  const rows = await options.source.query<{
    id: number;
    calculated_value: string | null;
  }>(
    `select id, calculated_value from indicators
      where company_id = ? and deleted_at is null and calculated = 1
        and calculated_value is not null and calculated_value <> ''
      order by id`,
    [options.companyId],
  );

  for (const row of rows) {
    tally.sawRow();
    const source = `indicators:${row.id}`;
    const kpiId = await options.resolver.resolve("indicators", row.id);
    if (!kpiId) {
      tally.skip(
        source,
        "This indicator did not import, so nor did its formula.",
      );
      continue;
    }

    const parsed = parseFormulaTokens(row.calculated_value ?? "");
    if (!parsed.ok) {
      tally.skip(
        source,
        `The formula "${(row.calculated_value ?? "").slice(0, 120)}" was dropped: ${parsed.reason}. The KPI imported with its recorded values and no calculation.`,
      );
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
      tally.skip(
        source,
        `The formula was dropped: it references indicator ${resolved.missing.join(", ")}, which did not import.`,
      );
      continue;
    }

    if (!options.write) {
      tally.wrote(true);
      continue;
    }

    // **Already stored is a match, not a write.** `kpis.setFormula` replaces
    // the edges and re-evaluates whether or not anything changed, so calling it
    // blind would make every re-run report writes it did not make and would
    // overwrite a formula somebody corrected in the product afterwards.
    const detail = await callAction(options.context, "kpis.detail", {
      kpiId,
      periods: 1,
    });
    if (
      detail.kpi.formula &&
      canonical(detail.kpi.formula) === canonical(resolved.tree)
    ) {
      tally.wrote(false);
      continue;
    }

    // **Evaluated for every period its references have data in, not just one.**
    // `kpis.setFormula` evaluates the period it is given, which is right for a
    // person setting a formula today and wrong for an import: the values it is
    // calculated from are last year's. Evaluating only today would store the
    // formula and leave every historical period empty, which is exactly the
    // history somebody migrates to keep.
    const periods = await periodsOf(options, parsed.references);
    try {
      for (const on of periods) {
        await callAction(options.context, "kpis.setFormula", {
          kpiId,
          formula: resolved.tree,
          on,
        });
      }
      tally.wrote(true);
    } catch (error) {
      // A cycle the source allowed and this product does not, most often.
      tally.skip(source, `The formula was dropped: ${messageOf(error)}`);
    }
  }

  return tally.finish();
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
  const rows = await options.source.query<{ period_key: string | null }>(
    `select distinct period_key from indicator_records
      where company_id = ? and deleted_at is null
        and indicator_id in (${references.map(() => "?").join(", ")})
      order by period_key`,
    [options.companyId, ...references],
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

/** An `employee_details` id into a member, through the user it belongs to. */
async function memberOf(
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

function numberOr(value: number | null): number | null {
  const parsed = Number(value ?? Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Something went wrong importing that indicator.";
}
