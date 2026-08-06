import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { systemSettings } from "../src/schema/system-settings.ts";
import { withInstanceAdmin } from "../src/tenant.ts";

/**
 * The instance-settings write floor.
 *
 * `system_settings` holds the deployment's encrypted credentials, so it gets
 * the same treatment as tenant data: a row-level security policy that refuses
 * by default, and an explicit transaction-local opt-in to write. An ordinary
 * request path never sets it, so a stray write is stopped by Postgres rather
 * than by review.
 */

const db = async () => drizzle((await workerDb()).appPool);

beforeEach(async () => {
  const wb = await workerDb();
  await wb.admin.query("delete from system_settings");
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("reading", () => {
  it("is open, because the mailer needs its configuration on every send", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "insert into system_settings (key, value) values ('mail.host', '\"smtp.example.com\"')",
    );

    const rows = await (await db()).select().from(systemSettings);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe("smtp.example.com");
  });
});

describe("writing without the opt-in", () => {
  it("refuses an insert", async () => {
    // No error is raised for a policy-blocked INSERT in every case, so this
    // asserts on the outcome: either it throws or it wrote nothing.
    const handle = await db();
    const attempt = handle
      .insert(systemSettings)
      .values({ key: "mail.host", value: "sneaky" })
      .then(
        () => "inserted",
        () => "refused",
      );

    expect(await attempt).toBe("refused");
  });

  it("silently affects no rows on an update, rather than changing one", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "insert into system_settings (key, value) values ('mail.host', '\"original\"')",
    );

    // An UPDATE filtered by a policy is not an error: the row is invisible to
    // the statement, so nothing matches. That is why this checks the stored
    // value rather than expecting a throw.
    await (await db()).execute(
      "update system_settings set value = '\"changed\"' where key = 'mail.host'",
    );

    const after = await wb.admin.query(
      "select value from system_settings where key = 'mail.host'",
    );
    expect(after.rows[0]?.value).toBe("original");
  });

  it("deletes nothing", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "insert into system_settings (key, value) values ('mail.host', '\"original\"')",
    );

    await (await db()).execute("delete from system_settings");

    const after = await wb.admin.query(
      "select count(*)::int from system_settings",
    );
    expect(after.rows[0]?.count).toBe(1);
  });
});

describe("writing with the opt-in", () => {
  it("inserts", async () => {
    await withInstanceAdmin(await db(), (tx) =>
      tx.insert(systemSettings).values({ key: "mail.host", value: "smtp" }),
    );

    const wb = await workerDb();
    const rows = await wb.admin.query("select value from system_settings");
    expect(rows.rows[0]?.value).toBe("smtp");
  });

  it("updates", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "insert into system_settings (key, value) values ('mail.host', '\"original\"')",
    );

    await withInstanceAdmin(await db(), (tx) =>
      tx.execute(
        "update system_settings set value = '\"changed\"' where key = 'mail.host'",
      ),
    );

    const after = await wb.admin.query(
      "select value from system_settings where key = 'mail.host'",
    );
    expect(after.rows[0]?.value).toBe("changed");
  });

  it("does not leak the opt-in into a later transaction", async () => {
    // set_config(..., true) is transaction-local. If it were not, one wizard
    // request would leave the connection permitted to write for every request
    // that reused it from the pool.
    const handle = await db();
    await withInstanceAdmin(handle, (tx) =>
      tx.insert(systemSettings).values({ key: "first", value: 1 }),
    );

    const second = await handle
      .insert(systemSettings)
      .values({ key: "second", value: 2 })
      .then(
        () => "inserted",
        () => "refused",
      );

    expect(second).toBe("refused");
  });
});

describe("a half-written secret", () => {
  it("is refused, because it could never be opened", async () => {
    const wb = await workerDb();
    const attempt = wb.admin
      .query(
        "insert into system_settings (key, secret_ciphertext) values ('mail.password', 'abc')",
      )
      .then(
        () => "inserted",
        () => "refused",
      );

    expect(await attempt).toBe("refused");
  });

  it("accepts all three secret columns together", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "insert into system_settings (key, secret_ciphertext, secret_data_key, secret_key_id) values ('mail.password', 'a', 'b', 'c')",
    );
    const rows = await wb.admin.query(
      "select count(*)::int from system_settings",
    );
    expect(rows.rows[0]?.count).toBe(1);
  });
});
