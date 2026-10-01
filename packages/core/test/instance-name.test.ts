import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { buildOpenApiDocument } from "../src/api/openapi.ts";
import {
  deploymentInstanceName,
  InstanceNameError,
  instanceNameToStore,
  readInstanceName,
  renameInstance,
  resolveInstanceName,
} from "../src/secrets/instance-name.ts";
import {
  DEFAULT_INSTANCE_NAME,
  instanceNameOr,
} from "../src/secrets/instance-registry.ts";
import { readSetting } from "../src/secrets/instance-settings.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import { completeSetup } from "../src/setup/complete.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * What an instance calls itself (completeness review M-33).
 *
 * `instance.name` was declared, bootstrapped from `OPENOKR_INSTANCE_NAME` and
 * written by the wizard, and nothing read it. So every screen, email and chat
 * message said "OpenOKR", and the wizard, which pre-filled "OpenOKR" and
 * stored whatever the field held, overwrote the variable for good.
 *
 * Each builder's own test says what it does with a name and without one. This
 * file holds the reader, the wizard's rule and the admin rename.
 */

const ring = parseKeyRing({ current: newRootKey() });
const NAMED = { OPENOKR_INSTANCE_NAME: "OKR Goal" };
const UNNAMED = {};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query("delete from system_settings");
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the reader", () => {
  it("says OpenOKR when nothing names the instance", async () => {
    const wb = await workerDb();
    expect(await resolveInstanceName(wb.appPool, UNNAMED)).toBe("OpenOKR");
    expect(await readInstanceName(wb.appPool, UNNAMED)).toEqual({
      value: "OpenOKR",
      source: "default",
    });
  });

  it("takes the environment's name when nothing is stored", async () => {
    const wb = await workerDb();
    expect(await resolveInstanceName(wb.appPool, NAMED)).toBe("OKR Goal");
  });

  it("ignores a blank variable, because a container delivers unset as empty", async () => {
    const wb = await workerDb();
    expect(
      await resolveInstanceName(wb.appPool, { OPENOKR_INSTANCE_NAME: "  " }),
    ).toBe("OpenOKR");
  });

  it("prefers a stored name to the environment's", async () => {
    const wb = await workerDb();
    await completeSetup(wb.appPool, ring, {
      settings: [{ key: "instance.name", value: "Acme OKR" }],
    });
    expect(await readInstanceName(wb.appPool, NAMED)).toEqual({
      value: "Acme OKR",
      source: "database",
    });
  });

  it("still answers when the database does not, with the deployment's name", async () => {
    // A name is display text: a tab title is no reason to fail a request.
    const down = {
      query: () => Promise.reject(new Error("connection refused")),
      connect: () => Promise.reject(new Error("connection refused")),
    } as unknown as Pool;
    expect(await resolveInstanceName(down, NAMED)).toBe("OKR Goal");
    expect(await resolveInstanceName(down, UNNAMED)).toBe("OpenOKR");
  });

  it("gives a builder that was handed no name the software's", () => {
    expect(instanceNameOr(undefined)).toBe(DEFAULT_INSTANCE_NAME);
    expect(instanceNameOr(" ")).toBe("OpenOKR");
    expect(instanceNameOr(" OKR Goal ")).toBe("OKR Goal");
    expect(deploymentInstanceName(NAMED)).toBe("OKR Goal");
  });
});

describe("the wizard", () => {
  it("stores no name when the field is left as it was pre-filled", async () => {
    const wb = await workerDb();
    const prefilled = await resolveInstanceName(wb.appPool, NAMED);
    const name = instanceNameToStore(prefilled, prefilled);
    expect(name).toBeNull();

    await completeSetup(wb.appPool, ring, {
      settings: name === null ? [] : [{ key: "instance.name", value: name }],
    });

    // Nothing stored, so the variable keeps deciding, including after it
    // changes. That is the property the demo deployment lost.
    expect(await readSetting(wb.appPool, "instance.name")).toBeUndefined();
    expect(
      await resolveInstanceName(wb.appPool, {
        OPENOKR_INSTANCE_NAME: "OKR Goal demo",
      }),
    ).toBe("OKR Goal demo");
  });

  it("stores the name the operator typed", () => {
    expect(instanceNameToStore(" Acme OKR ", "OKR Goal")).toBe("Acme OKR");
  });

  it("stores nothing for an emptied field, or one differing only in spaces", () => {
    expect(instanceNameToStore("   ", "OKR Goal")).toBeNull();
    expect(instanceNameToStore(" OKR Goal ", "OKR Goal")).toBeNull();
  });
});

describe("renaming from administration", () => {
  const by = { userId: "rename-admin", workspaceId: "ws-rename" };

  const renames = async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{
      payload: Record<string, unknown>;
    }>(
      "select payload from instance_audit_events where action = 'instance.renamed' order by seq",
    );
    return rows.map((row) => row.payload);
  };

  it("stores the name, and records who did it and what it was", async () => {
    const wb = await workerDb();
    const before = (await renames()).length;

    expect(
      await renameInstance(
        wb.appPool,
        ring,
        { name: "Acme OKR", ...by },
        NAMED,
      ),
    ).toBe("renamed");

    expect(await resolveInstanceName(wb.appPool, NAMED)).toBe("Acme OKR");
    const source = await wb.admin.query(
      "select source from system_settings where key = 'instance.name'",
    );
    expect(source.rows[0]?.source).toBe("admin");
    const recorded = await renames();
    expect(recorded).toHaveLength(before + 1);
    expect(recorded.at(-1)).toEqual({
      from: "OKR Goal",
      to: "Acme OKR",
      cleared: false,
      ...by,
    });
  });

  it("does nothing when the name is the one already in use", async () => {
    const wb = await workerDb();
    const before = (await renames()).length;
    expect(
      await renameInstance(
        wb.appPool,
        ring,
        { name: "OKR Goal", ...by },
        NAMED,
      ),
    ).toBe("unchanged");
    // Saving the card untouched must not copy the variable into the
    // database, for the reason the wizard must not.
    expect(await readSetting(wb.appPool, "instance.name")).toBeUndefined();
    expect(await renames()).toHaveLength(before);
  });

  it("goes back to the deployment's name when the field is cleared", async () => {
    const wb = await workerDb();
    await renameInstance(wb.appPool, ring, { name: "Acme OKR", ...by }, NAMED);

    expect(
      await renameInstance(wb.appPool, ring, { name: "  ", ...by }, NAMED),
    ).toBe("cleared");
    expect(await readInstanceName(wb.appPool, NAMED)).toEqual({
      value: "OKR Goal",
      source: "environment",
    });
    expect((await renames()).at(-1)).toMatchObject({
      from: "Acme OKR",
      to: "OKR Goal",
      cleared: true,
    });
  });

  it("refuses a name longer than the wizard allows", async () => {
    const wb = await workerDb();
    await expect(
      renameInstance(wb.appPool, ring, { name: "x".repeat(121), ...by }, NAMED),
    ).rejects.toBeInstanceOf(InstanceNameError);
    expect(await readSetting(wb.appPool, "instance.name")).toBeUndefined();
  });
});

describe("the channel test message", () => {
  const OWNER = "instance-name-owner";

  const testSend = async (instanceName?: string) => {
    const wb = await workerDb();
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, 'Owner', 'instance-name-owner@example.com') on conflict do nothing",
      [OWNER],
    );
    const { workspaceId } = await provisionWorkspaceForUser(wb.appPool, {
      id: OWNER,
      name: "Owner",
    });
    await callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        ...(instanceName ? { instanceName } : {}),
      },
      "channels.testSend",
      { attempt: "one" },
    );
    const { rows } = await wb.admin.query<{
      payload: { text: string; subject: string };
    }>("select payload from channel_messages where workspace_id = $1", [
      workspaceId,
    ]);
    return rows[0]?.payload;
  };

  it("names the instance it came from", async () => {
    expect(await testSend("OKR Goal")).toEqual({
      text: "This is a test from OKR Goal. Your channel works.",
      subject: "OKR Goal test message",
    });
  });

  it("says OpenOKR when the host gives no name", async () => {
    expect(await testSend()).toEqual({
      text: "This is a test from OpenOKR. Your channel works.",
      subject: "OpenOKR test message",
    });
  });
});

describe("the live API document", () => {
  it("carries the instance's name, and the committed one the software's", () => {
    const live = buildOpenApiDocument({ title: "OKR Goal" }) as {
      info: { title: string };
    };
    const committed = buildOpenApiDocument() as { info: { title: string } };
    expect(live.info.title).toBe("OKR Goal");
    // What `pnpm check:contract` compares against: no instance, no rename.
    expect(committed.info.title).toBe("OpenOKR");
  });
});
