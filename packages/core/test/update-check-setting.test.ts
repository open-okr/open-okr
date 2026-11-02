import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import {
  readUpdateCheck,
  setUpdateCheck,
} from "../src/secrets/update-check.ts";

/**
 * The switch for the update check (docs/design/version-footer.md §4).
 *
 * On with nothing configured, off from the environment for an air-gapped
 * operator, and turned either way from Admin, General with an instance audit
 * row naming who did it.
 */

const ring = parseKeyRing({ current: newRootKey() });

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query("delete from system_settings");
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

const changes = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ payload: Record<string, unknown> }>(
    "select payload from instance_audit_events where action = 'instance.update_check_set' order by seq",
  );
  return rows.map((row) => row.payload);
};

describe("the update check switch", () => {
  it("is on when nothing is configured", async () => {
    const wb = await workerDb();
    expect(await readUpdateCheck(wb.appPool, {})).toEqual({
      value: true,
      source: "default",
    });
  });

  it("is off when the operator says so in the environment", async () => {
    const wb = await workerDb();
    for (const raw of ["off", "false", "0", "no"]) {
      expect(
        (await readUpdateCheck(wb.appPool, { OPENOKR_UPDATE_CHECK: raw }))
          .value,
      ).toBe(false);
    }
  });

  it("is turned off and on from administration, and audited", async () => {
    const wb = await workerDb();
    const by = { userId: "update-admin", workspaceId: "ws-update" };

    expect(
      await setUpdateCheck(wb.appPool, ring, { enabled: false, ...by }, {}),
    ).toBe("changed");
    expect((await readUpdateCheck(wb.appPool, {})).value).toBe(false);
    expect(
      await setUpdateCheck(wb.appPool, ring, { enabled: false, ...by }, {}),
    ).toBe("unchanged");

    await setUpdateCheck(wb.appPool, ring, { enabled: true, ...by }, {});
    expect((await readUpdateCheck(wb.appPool, {})).value).toBe(true);

    expect(await changes()).toEqual([
      { from: true, to: false, ...by },
      { from: false, to: true, ...by },
    ]);
  });

  it("stored in the product, wins over the environment", async () => {
    const wb = await workerDb();
    const env = { OPENOKR_UPDATE_CHECK: "off" };
    await setUpdateCheck(
      wb.appPool,
      ring,
      { enabled: true, userId: "u", workspaceId: "w" },
      env,
    );
    expect(await readUpdateCheck(wb.appPool, env)).toEqual({
      value: true,
      source: "database",
    });
  });
});
