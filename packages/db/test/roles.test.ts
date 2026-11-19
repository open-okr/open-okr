import { randomUUID } from "node:crypto";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { ensureLoginRole } from "../src/roles.ts";

/**
 * The role a deployment's application runs as (completeness review H-01).
 *
 * The Compose install connected as the Postgres image's superuser, so the
 * tenant floor never applied to the running product. The migrator now creates
 * a separate application role with this function, and the property that
 * matters is that the role it leaves behind can never bypass row-level
 * security, whatever state it found.
 */

const ROLE = `openokr_test_login_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

const superuser = async (): Promise<pg.Client> => {
  const client = new pg.Client(
    connectionOptions("postgres", testDbEnv.superuser),
  );
  await client.connect();
  return client;
};

const attributes = async () => {
  const client = await superuser();
  try {
    const { rows } = await client.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcanlogin: boolean;
    }>(
      "select rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = $1",
      [ROLE],
    );
    return rows[0];
  } finally {
    await client.end();
  }
};

const canSignIn = async (password: string): Promise<boolean> => {
  const client = new pg.Client({
    ...connectionOptions("postgres", ROLE),
    password,
  });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
};

afterAll(async () => {
  const client = await superuser();
  try {
    await client.query(`drop role if exists ${ROLE}`);
  } finally {
    await client.end();
  }
});

describe("ensureLoginRole", () => {
  it("creates a role that can sign in and cannot bypass the floor", async () => {
    const client = await superuser();
    try {
      await ensureLoginRole(client, { role: ROLE, password: "first-secret" });
    } finally {
      await client.end();
    }
    expect(await attributes()).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcanlogin: true,
    });
    expect(await canSignIn("first-secret")).toBe(true);
  });

  it("applies a changed password to a role that already exists", async () => {
    const client = await superuser();
    try {
      await ensureLoginRole(client, { role: ROLE, password: "second-secret" });
    } finally {
      await client.end();
    }
    expect(await canSignIn("first-secret")).toBe(false);
    expect(await canSignIn("second-secret")).toBe(true);
  });

  it("narrows a role somebody widened by hand, rather than trusting it", async () => {
    const client = await superuser();
    try {
      await client.query(`alter role ${ROLE} superuser bypassrls`);
      await ensureLoginRole(client, { role: ROLE, password: "second-secret" });
    } finally {
      await client.end();
    }
    const after = await attributes();
    expect(after?.rolsuper).toBe(false);
    expect(after?.rolbypassrls).toBe(false);
  });

  it("refuses an empty password and a name that is not a role name", async () => {
    const client = await superuser();
    try {
      await expect(
        ensureLoginRole(client, { role: ROLE, password: "" }),
      ).rejects.toThrow(/password/);
      await expect(
        ensureLoginRole(client, { role: "bad; drop", password: "x" }),
      ).rejects.toThrow(/Invalid role name/);
    } finally {
      await client.end();
    }
  });
});
