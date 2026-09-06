/**
 * The six entity templates, by name (P6-T01a).
 *
 * The names are the `--entity` values §7 prints, and the order is dependency
 * order: objectives before their measures, KPIs before their records,
 * initiatives before the tasks that hang off them. A person importing a whole
 * workspace runs them in this order, and nothing here enforces that, because a
 * row whose reference is missing says so by name and is a better error than a
 * refusal to start.
 */
import { goalsTemplate } from "./goals.ts";
import { initiativesTemplate } from "./initiatives.ts";
import { keyResultsTemplate } from "./key-results.ts";
import { kpiRecordsTemplate } from "./kpi-records.ts";
import { kpisTemplate } from "./kpis.ts";
import { tasksTemplate } from "./tasks.ts";
import type { EntityTemplate } from "./types.ts";

export const TEMPLATES: readonly EntityTemplate[] = [
  goalsTemplate,
  keyResultsTemplate,
  kpisTemplate,
  kpiRecordsTemplate,
  initiativesTemplate,
  tasksTemplate,
];

/** The entity names, in dependency order. */
export const ENTITIES = TEMPLATES.map((template) => template.entity);

export function templateFor(entity: string): EntityTemplate {
  const found = TEMPLATES.find((template) => template.entity === entity);
  if (!found) {
    throw new Error(
      `There is no template for "${entity}". The entities are: ${ENTITIES.join(", ")}.`,
    );
  }
  return found;
}

export { goalsTemplate } from "./goals.ts";
export { keyResultsTemplate } from "./key-results.ts";
export type {
  ColumnSpec,
  EntityTemplate,
  LegacyTableName,
  PlanContext,
  References,
  RowPlan,
} from "./types.ts";
