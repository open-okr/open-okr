/**
 * What an entity template is (TECHNICAL-PLAN §7.1 step 2, P6-T01a).
 *
 * A template is the whole of what the importer knows about one kind of row: the
 * columns it accepts, which of them a row cannot do without, how a piece of
 * text becomes a value, and which registry action writes it. Everything else in
 * this package is generic over these declarations, which is why adding an
 * entity is one file rather than a branch in the runner.
 *
 * **The template names actions, it does not call them.** The runner calls, so
 * the dry run is the same code path as the real run right up to the last step
 * and cannot drift from it. That is what makes "the real run matches the
 * report" a property rather than a hope.
 */

/** A resolver the runner hands to a template, for a name or an identifier that has to become an id. */
export interface References {
  /** A space by id, by name, or by the legacy identifier an earlier run gave it. */
  space(text: string): Promise<string>;
  /** A member by id or by email address. */
  member(text: string): Promise<string>;
  /** A cycle by id, by label, or by name. */
  cycle(text: string): Promise<string>;
  goal(text: string): Promise<string>;
  keyResult(text: string): Promise<string>;
  kpi(text: string): Promise<string>;
  initiative(text: string): Promise<string>;
}

/** One column of a template. */
export interface ColumnSpec {
  /** The template's own name for it, and what a mapping maps a header to. */
  readonly field: string;
  /** What it is, in a sentence, for the report and for the wizard in P6-T01b. */
  readonly describe: string;
  /**
   * Header spellings this column answers to when no mapping is supplied.
   *
   * Matched case-insensitively and ignoring spaces and punctuation, so
   * "Key result", "key_result" and "KEY RESULT" are one alias rather than
   * three. The AI mapper in P6-T01b proposes over the same list.
   */
  readonly aliases: readonly string[];
  readonly required: boolean;
}

/** What a template asks the runner to do with one row. */
export type RowPlan =
  | {
      /** The row does not exist yet: create it, carrying its legacy identity. */
      readonly kind: "create";
      readonly action: string;
      readonly input: Record<string, unknown>;
    }
  | {
      /** A row with this legacy identity is already here: update that one. */
      readonly kind: "update";
      readonly action: string;
      readonly input: Record<string, unknown>;
    }
  | {
      /**
       * The action is an upsert in its own right, so create and update are the
       * same call. `kpis.record` is the one: it is unique per period, and the
       * period is what makes a re-run idempotent rather than a legacy key.
       */
      readonly kind: "upsert";
      readonly action: string;
      readonly input: Record<string, unknown>;
    };

/** Everything a template needs to plan one row. */
export interface PlanContext {
  /** The row's declared values, already coerced, keyed by field. */
  readonly values: Readonly<Record<string, string>>;
  /** The row's legacy identity, when the template has one. */
  readonly legacyId: string;
  /** The id of the row an earlier run created with this legacy identity, if any. */
  readonly existingId: string | undefined;
  readonly references: References;
}

export interface EntityTemplate {
  /** The `--entity` value, and what `import_runs.entity` records. */
  readonly entity: string;
  /** What a file of these rows is, in a sentence. */
  readonly describe: string;
  readonly columns: readonly ColumnSpec[];
  /**
   * The field carrying the source system's own identifier for the row, when
   * idempotency comes from a legacy key.
   *
   * Absent for an entity whose action is already an upsert on a natural key.
   */
  readonly legacyField?: string;
  /** The table the runner looks the legacy key up in, by name. */
  readonly legacyTable?: LegacyTableName;
  plan(context: PlanContext): Promise<RowPlan>;
}

/** The tables a spreadsheet import can hold a legacy key in. */
const LEGACY_TABLE_NAMES = [
  "goals",
  "keyResults",
  "kpis",
  "initiatives",
  "tasks",
] as const;

export type LegacyTableName = (typeof LEGACY_TABLE_NAMES)[number];
