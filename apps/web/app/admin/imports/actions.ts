"use server";

/**
 * The import wizard's four steps, as three server actions (S-36, P6-T01b-b).
 *
 * **The file is read here and nowhere else.** The browser posts bytes and gets
 * back a table it did not parse, which is the whole reason `readBuffer` exists
 * beside `readTable`: one CSV parser and one spreadsheet reader in the product,
 * shared by the wizard and by `pnpm import:csv`. A second parser in the browser
 * would be a second set of edge cases to disagree about quoted commas.
 *
 * **The preview and the run are the registry's, not this file's.** Everything
 * here does is carry a table to `imports.previewTable` or `imports.runTable`
 * and hand back what they answered. The sentence a reader sees when a row is
 * refused is the one `packages/core` wrote.
 */
import {
  callAction,
  DEFAULT_IMPORT_ROW_LIMIT,
  matchHeadersByAlias,
  OperationError,
  readBuffer,
  templateFor,
} from "@openokr/core";
import { revalidatePath } from "next/cache";
import { getPool } from "../../../lib/auth";
import { drafterFor } from "../../../lib/drafter";
import { requireWorkspace } from "../../../lib/workspace";

/** One column of a file, as the mapping step draws it. */
export interface UploadedColumn {
  readonly header: string;
  /** The first body row's value, so a header alone is not the only clue. */
  readonly sample: string;
  /** What the aliases or the proposal claimed, or null for unclaimed. */
  readonly field: string | null;
  /** True when the proposal claimed it rather than the aliases. */
  readonly proposed: boolean;
}

export interface UploadResult {
  readonly filename: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly columns: readonly UploadedColumn[];
  /** What the model said about its own answer, when there was one. */
  readonly notes: string | null;
}

interface RowOutcomeView {
  readonly line: number;
  readonly outcome: "created" | "updated" | "skipped";
  readonly externalId?: string;
  readonly reason?: string;
}

export interface ReportView {
  readonly mode: "dry_run" | "real";
  readonly rowsRead: number;
  readonly created: number;
  readonly updated: number;
  readonly skipped: number;
  readonly unmappedHeaders: readonly string[];
  readonly rows: readonly RowOutcomeView[];
}

/** Either an answer or a sentence to show. Never a stack trace. */
export type Answer<T> = { ok: true; value: T } | { ok: false; error: string };

function refusal(error: unknown): { ok: false; error: string } {
  if (error instanceof OperationError) {
    return { ok: false, error: error.message };
  }
  if (error instanceof Error && error.message) {
    // The engine's own refusals are plain Errors with sentences written for a
    // reader: an unreadable extension, a mapping missing a required field.
    return { ok: false, error: error.message };
  }
  return { ok: false, error: "That file could not be read." };
}

async function context() {
  const { session, workspace } = await requireWorkspace();
  return {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
}

/** The workspace's own bound, or the default it inherits. */
async function rowLimit(): Promise<number> {
  const read = await callAction(
    await context(),
    "settings.readWorkspaceSettings",
    {},
  );
  const stored = (read.settings as Record<string, unknown>).importRowLimit;
  return typeof stored === "number" && Number.isInteger(stored) && stored > 0
    ? stored
    : DEFAULT_IMPORT_ROW_LIMIT;
}

/**
 * Step one: the file becomes a table, and the columns get a first answer.
 *
 * The bound is checked here as well as inside the two actions, so a reader
 * learns their file is too big before they spend a step confirming a mapping
 * for it. The action is still the enforcement; this is only the earlier of the
 * two places it is said.
 */
export async function readUploadAction(
  formData: FormData,
): Promise<Answer<UploadResult>> {
  const entity = String(formData.get("entity") ?? "");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file first." };
  }

  try {
    const template = templateFor(entity);
    const bytes = Buffer.from(await file.arrayBuffer());
    const table = await readBuffer(file.name, bytes);

    if (table.rows.length === 0) {
      return {
        ok: false,
        error: "That file has a header row and nothing under it.",
      };
    }
    const limit = await rowLimit();
    if (table.rows.length > limit) {
      return {
        ok: false,
        error: `That file has ${table.rows.length} rows and this workspace imports at most ${limit} in one run. Split it, raise the limit, or use the command line, which reads a file from disk and has no bound.`,
      };
    }

    // The aliases first, because they are the whole of the manual path and they
    // answer with no provider configured. The proposal only ever fills columns
    // they left empty. The matching itself is the runner's own, imported rather
    // than repeated: what "Owner" means is a property of the template.
    const byAlias = new Map(
      Object.entries(matchHeadersByAlias(template, table.headers)),
    );
    const taken = new Set(byAlias.values());

    const proposal = await propose(entity, table, byAlias);
    const columns: UploadedColumn[] = table.headers.map((header, index) => {
      const fromAlias = byAlias.get(header) ?? null;
      const fromModel = proposal?.columns[header] ?? null;
      const field =
        fromAlias ?? (taken.has(fromModel ?? "") ? null : fromModel);
      if (field && !fromAlias) {
        taken.add(field);
      }
      return {
        header,
        sample: table.rows[0]?.[index] ?? "",
        field,
        proposed: field !== null && fromAlias === null,
      };
    });

    return {
      ok: true,
      value: {
        filename: file.name,
        headers: table.headers,
        rows: table.rows,
        columns,
        notes: proposal?.notes ? proposal.notes : null,
      },
    };
  } catch (error) {
    return refusal(error);
  }
}

/**
 * The model's proposal, or nothing.
 *
 * Nothing is the normal case: no provider, the feature off, a refusal. The
 * columns the aliases already claimed are what the wizard shows either way,
 * which is what "the manual mapping path is complete without it" means here.
 */
async function propose(
  entity: string,
  table: { headers: readonly string[]; rows: readonly (readonly string[])[] },
  byAlias: ReadonlyMap<string, string>,
): Promise<{ columns: Record<string, string>; notes: string } | null> {
  if (byAlias.size === table.headers.length) {
    // Every column is already spoken for. Asking a model to confirm what the
    // aliases matched would spend a call to change nothing.
    return null;
  }
  const base = await context();
  const drafter = await drafterFor(base.workspaceId);
  if (!drafter) {
    return null;
  }
  const proposal = await callAction(
    { ...base, drafter },
    "imports.proposeMapping",
    {
      entity,
      headers: [...table.headers],
      sample: [...(table.rows[0] ?? [])],
    },
  );
  return proposal ? { columns: proposal.columns, notes: proposal.notes } : null;
}

export interface RunInput {
  readonly entity: string;
  readonly name: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly mapping: Readonly<Record<string, string | null>>;
}

/** Step three: what this mapping would write, written down and nothing else. */
export async function previewImportAction(
  input: RunInput,
): Promise<Answer<ReportView>> {
  return carry(input, "imports.previewTable");
}

/** Step four: the same table, the same mapping, and this time it writes. */
export async function runImportAction(
  input: RunInput,
): Promise<Answer<ReportView>> {
  const answer = await carry(input, "imports.runTable");
  if (answer.ok) {
    // The run list on this page, and the feed the import wrote into.
    revalidatePath("/admin/imports");
  }
  return answer;
}

async function carry(
  input: RunInput,
  action: "imports.previewTable" | "imports.runTable",
): Promise<Answer<ReportView>> {
  try {
    const result = await callAction(await context(), action, {
      entity: input.entity,
      table: {
        headers: [...input.headers],
        rows: input.rows.map((r) => [...r]),
      },
      name: input.name,
      mapping: { ...input.mapping },
    });
    return { ok: true, value: result.report };
  } catch (error) {
    return refusal(error);
  }
}
