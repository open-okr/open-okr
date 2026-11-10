import { copyFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  connectionOptions,
  testDbEnv,
  workerDb,
} from "@openokr/test-support/db";
import pg from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../src/migrate.ts";

/**
 * Migrating where pgvector is offered (plan 0.8.0 H5,
 * docs/design/pgvector-migration.md).
 *
 * Until 0.8.0, 0031 stopped every database with the extension: it built an
 * hnsw index on a column with no dimensions, which pgvector refuses. The
 * default test stack has no pgvector, so CI only ever took the other branch.
 * CI's pgvector leg runs this file on `pgvector/pgvector:pg17` with
 * `TEST_PGVECTOR=1`, and there a missing extension fails rather than skips.
 * Elsewhere the tests that need it skip themselves and say why.
 */

const MIGRATIONS = join(import.meta.dirname, "../migrations");

/** Every migration that sorts before `prefix`, as an older release shipped. */
function migrationsBefore(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), "openokr-pgvector-"));
  for (const name of readdirSync(MIGRATIONS)) {
    if (name.endsWith(".sql") && name < prefix) {
      copyFileSync(join(MIGRATIONS, name), join(dir, name));
    }
  }
  return dir;
}

let scratchDb: string;
let offered = false;

beforeEach(async () => {
  const wb = await workerDb();
  scratchDb = `${wb.databaseName}_pgvector`;
  await wb.admin.query(`drop database if exists ${scratchDb} with (force)`);
  // Owned by the owner role, as a deployment's database is, so a test can
  // migrate as the owner or as the superuser.
  await wb.admin.query(
    `create database ${scratchDb} owner ${testDbEnv.ownerRole} ` +
      `encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`,
  );
  const { rows } = await wb.admin.query<{ offered: boolean }>(
    "select exists (select 1 from pg_available_extensions where name = 'vector') as offered",
  );
  offered = rows[0]?.offered ?? false;
});

afterEach(async () => {
  const wb = await workerDb();
  await wb.admin.query(`drop database if exists ${scratchDb} with (force)`);
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

/** Skips a test that needs pgvector, unless the leg says it must be there. */
function needsPgvector(skip: () => void): void {
  if (offered) {
    return;
  }
  if (testDbEnv.pgvector) {
    throw new Error(
      "TEST_PGVECTOR=1, but this Postgres does not offer the vector extension.",
    );
  }
  skip();
}

async function connect(role: string): Promise<pg.Client> {
  const client = new pg.Client(connectionOptions(scratchDb, role));
  await client.connect();
  return client;
}

/** The embedding column's type, as `format_type` names it. */
async function embeddingType(client: pg.Client): Promise<string | undefined> {
  const { rows } = await client.query<{ type: string }>(
    `select format_type(atttypid, atttypmod) as type from pg_attribute
      where attrelid = 'embeddings'::regclass and attname = 'embedding'`,
  );
  return rows[0]?.type;
}

/** The indexes on `embeddings`, by name. */
async function embeddingIndexes(client: pg.Client): Promise<string[]> {
  const { rows } = await client.query<{ indexname: string }>(
    "select indexname from pg_indexes where tablename = 'embeddings' order by indexname",
  );
  return rows.map((row) => row.indexname);
}

describe("migrating where pgvector is offered", () => {
  it("applies every migration as the superuser, and the column is a vector with no index", async (context) => {
    needsPgvector(() => context.skip());
    const client = await connect(testDbEnv.superuser);
    try {
      const applied = await runMigrations(client, { dirs: [MIGRATIONS] });

      expect(applied).toContain("0031_embeddings.sql");
      expect(applied).toContain("0166_embeddings_vector.sql");
      expect(await embeddingType(client)).toBe("vector");
      expect(await embeddingIndexes(client)).toEqual([
        "embeddings_content_hash_idx",
        "embeddings_entity_chunk_idx",
        "embeddings_pkey",
      ]);
    } finally {
      await client.end();
    }
  }, 60_000);

  it("applies every migration as the owner once an operator has created the extension", async (context) => {
    // Managed Postgres: pgvector is not a trusted extension, so the role that
    // runs migrations may not create it, and the operator does it first.
    needsPgvector(() => context.skip());
    const superuser = await connect(testDbEnv.superuser);
    await superuser.query("create extension vector");
    await superuser.end();

    const owner = await connect(testDbEnv.ownerRole);
    try {
      await runMigrations(owner, { dirs: [MIGRATIONS] });
      expect(await embeddingType(owner)).toBe("vector");
    } finally {
      await owner.end();
    }
  }, 60_000);

  it("0166 turns a text column into a vector once the extension arrives, keeping what it held", async (context) => {
    needsPgvector(() => context.skip());
    // 0.7.0 migrated by an owner that could not create the extension: 0031
    // ran its other branch and the column stayed text.
    const owner = await connect(testDbEnv.ownerRole);
    try {
      await runMigrations(owner, { dirs: [migrationsBefore("0166")] });
      expect(await embeddingType(owner)).toBe("text");
      const { rows } = await owner.query<{ id: string }>(
        "select gen_random_uuid() as id",
      );
      const workspaceId = rows[0]?.id as string;
      await owner.query("begin");
      await owner.query("select set_config('app.workspace_id', $1, true)", [
        workspaceId,
      ]);
      await owner.query(
        "insert into workspaces (id, name, slug) values ($1, 'Acme', 'acme')",
        [workspaceId],
      );
      // What the worker wrote to a text column with the extension present,
      // and a chunk with no vector.
      await owner.query(
        `insert into embeddings (id, workspace_id, entity_type, entity_id,
                                 chunk_index, content, content_hash,
                                 dimensions, embedding)
         values (gen_random_uuid(), $1, 'goal', gen_random_uuid(), 0, 'One',
                 'a', 3, '[0.1,0.2,0.3]'),
                (gen_random_uuid(), $1, 'goal', gen_random_uuid(), 0, 'Two',
                 'b', null, null)`,
        [workspaceId],
      );
      await owner.query("commit");

      // The operator adds the extension, then upgrades.
      const superuser = await connect(testDbEnv.superuser);
      await superuser.query("create extension vector");
      await superuser.end();
      const applied = await runMigrations(owner, { dirs: [MIGRATIONS] });

      expect(applied).toContain("0166_embeddings_vector.sql");
      expect(await embeddingType(owner)).toBe("vector");
      await owner.query("begin");
      await owner.query("select set_config('app.workspace_id', $1, true)", [
        workspaceId,
      ]);
      const kept = await owner.query<{ embedding: string | null }>(
        "select embedding::text as embedding from embeddings order by content",
      );
      await owner.query("commit");
      expect(kept.rows.map((row) => row.embedding)).toEqual([
        "[0.1,0.2,0.3]",
        null,
      ]);
    } finally {
      await owner.end();
    }
  }, 60_000);
});

describe("migrating where pgvector is not there", () => {
  it("keeps the column as text, and 0166 changes nothing", async (context) => {
    if (offered) {
      // The superuser would create it here, which is the other describe.
      context.skip();
    }
    const client = await connect(testDbEnv.ownerRole);
    try {
      const applied = await runMigrations(client, { dirs: [MIGRATIONS] });
      expect(applied).toContain("0166_embeddings_vector.sql");
      expect(await embeddingType(client)).toBe("text");
    } finally {
      await client.end();
    }
  }, 60_000);
});
