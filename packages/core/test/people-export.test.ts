import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { EXPORT_MANIFEST, type ExportTable } from "../src/people/export.ts";

/**
 * The manifest is the export (P7-T08b).
 *
 * Forty-eight tables in this schema carry a member column. An export
 * written against the ones somebody remembered would be wrong the first
 * time a table was added, and wrong *silently*: a missing table looks
 * exactly like a member who wrote nothing.
 *
 * So this reads the schema source and holds both directions. A table with a
 * member column and no entry fails. An entry naming a table or a column
 * that no longer exists fails too, because a manifest quietly pointing at
 * nothing is the same failure wearing the opposite mask.
 */

const SCHEMA_DIR = join(import.meta.dirname, "..", "..", "db", "src", "schema");

interface SchemaColumn {
  readonly table: string;
  readonly column: string;
}

/** Every `<table>.<column>` in the schema where the column names a member. */
function memberColumnsInSchema(): SchemaColumn[] {
  const found: SchemaColumn[] = [];
  for (const file of readdirSync(SCHEMA_DIR).filter((name) =>
    name.endsWith(".ts"),
  )) {
    const source = readFileSync(join(SCHEMA_DIR, file), "utf8");
    const tables = [
      ...source.matchAll(/export const \w+ = pgTable\(\s*["']([\w_]+)["']/g),
    ];
    for (const [index, match] of tables.entries()) {
      const start = match.index;
      const end = tables[index + 1]?.index ?? source.length;
      const body = source.slice(start, end);
      for (const column of body.matchAll(
        /\w*[Mm]emberId\s*:\s*uuid\(\s*["']([\w_]+)["']/g,
      )) {
        found.push({
          table: match[1] as string,
          column: column[1] as string,
        });
      }
    }
  }
  return found;
}

const schemaColumns = memberColumnsInSchema();
const inManifest = new Set(
  EXPORT_MANIFEST.map((entry) => `${entry.table}.${entry.column}`),
);

describe("the export manifest covers the schema", () => {
  it("finds enough member columns to be believed", () => {
    // A parse that finds nothing agrees with everything. The floor is the
    // guard that stops a broken regex passing this file silently, the same
    // one the conformance suite uses on every list it compares.
    expect(schemaColumns.length).toBeGreaterThanOrEqual(40);
  });

  it.each(schemaColumns.map((entry) => `${entry.table}.${entry.column}`))(
    "%s is classified",
    (key) => {
      expect(
        inManifest.has(key),
        `${key} holds a member and is not in EXPORT_MANIFEST. Decide whether ` +
          "it is that member's data. A table missing from the manifest is " +
          "absent from every export and looks exactly like a member who " +
          "wrote nothing.",
      ).toBe(true);
    },
  );

  it("names no table the schema does not have", () => {
    const inSchema = new Set(
      schemaColumns.map((entry) => `${entry.table}.${entry.column}`),
    );
    for (const entry of EXPORT_MANIFEST) {
      expect(
        inSchema.has(`${entry.table}.${entry.column}`),
        `${entry.table}.${entry.column} is in the manifest and not in the ` +
          "schema. A manifest pointing at nothing is the same failure as a " +
          "missing one, wearing the opposite mask.",
      ).toBe(true);
    }
  });
});

describe("every skip is argued", () => {
  const skipped = EXPORT_MANIFEST.filter(
    (
      entry,
    ): entry is ExportTable & { skip: NonNullable<ExportTable["skip"]> } =>
      entry.skip !== undefined,
  );

  it("leaves out enough to be a real decision rather than a formality", () => {
    expect(skipped.length).toBeGreaterThan(5);
  });

  it.each(skipped.map((entry) => entry.table))(
    "%s says why it is left out",
    (table) => {
      const entry = skipped.find((candidate) => candidate.table === table);
      // "Not their data" is a claim about somebody's personal information.
      // A claim like that belongs in writing where the next person can
      // disagree with it, which is the same rule every marker in this
      // repository follows.
      expect(entry?.because ?? "", table).not.toBe("");
      expect((entry?.because ?? "").length, table).toBeGreaterThan(20);
    },
  );

  it("never leaves out something it also labels", () => {
    // A row carrying both a label and a skip is an entry somebody edited
    // halfway. The label is what a person reads in the export, so the two
    // together would mean the file promises a section it never writes.
    for (const entry of EXPORT_MANIFEST) {
      if (entry.skip) {
        expect(entry.label, entry.table).toBeUndefined();
      }
    }
  });
});

describe("what the export carries", () => {
  it("includes what they wrote", () => {
    // The point of the export, stated as a test rather than as a comment.
    // If any of these stops being exported, somebody has decided a member's
    // own check-ins are not their data, and that should fail here.
    const exported = new Set(
      EXPORT_MANIFEST.filter((entry) => !entry.skip).map(
        (entry) => entry.table,
      ),
    );
    for (const table of [
      "check_ins",
      "comments",
      "decisions",
      "retro_notes",
      "documents",
      "key_result_values",
      "objective_trends",
      "review_narratives",
    ]) {
      expect(exported.has(table), table).toBe(true);
    }
  });

  it("leaves the credentials out", () => {
    // Handing back a token in a file is handing back a credential. Erasure
    // deletes these; an export must not reissue them.
    const exported = new Set(
      EXPORT_MANIFEST.filter((entry) => !entry.skip).map(
        (entry) => entry.table,
      ),
    );
    for (const table of [
      "api_tokens",
      "oauth_grants",
      "ai_credentials",
      "channel_identities",
    ]) {
      expect(exported.has(table), table).toBe(false);
    }
  });

  it("leaves the audit trail out", () => {
    // Append-only by design, and the instance's record rather than the
    // member's. An export that carried it would suggest it were theirs to
    // take away.
    const audit = EXPORT_MANIFEST.find(
      (entry) => entry.table === "audit_events",
    );
    expect(audit?.skip).toBe("workspace_record");
  });
});
