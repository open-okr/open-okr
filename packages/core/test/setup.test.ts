import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readSetting } from "../src/secrets/instance-settings.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import { completeSetup } from "../src/setup/complete.ts";
import {
  blockingFailures,
  type ConnectionProbe,
  runConnectionTests,
} from "../src/setup/connection-tests.ts";
import {
  databaseProbe,
  mailProbe,
  notInThisBuild,
} from "../src/setup/probes.ts";
import { readSetupState } from "../src/setup/state.ts";
import { isRegistrationOpen } from "../src/workspaces/registration.ts";

/**
 * The first-run wizard: connection tests, completion, and what completion
 * does to registration.
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

describe("connection tests", () => {
  it("times each probe", async () => {
    let clock = 0;
    const probe: ConnectionProbe = {
      port: "database",
      run: async () => {
        clock += 25;
        return { outcome: "ok" as const, detail: "fine" };
      },
    };

    const [result] = await runConnectionTests([probe], () => clock);
    expect(result?.milliseconds).toBe(25);
  });

  it("reports a throwing probe as a failure rather than taking the wizard down", async () => {
    // An operator midway through setup must not lose the page because a mail
    // server refused a connection.
    const probe: ConnectionProbe = {
      port: "mail",
      run: async () => {
        throw new Error("ECONNREFUSED 10.0.0.1:587\nwith a transcript below");
      },
    };

    const [result] = await runConnectionTests([probe]);
    expect(result?.outcome).toBe("failed");
    // First line only: the rest is the SMTP conversation.
    expect(result?.detail).toBe("ECONNREFUSED 10.0.0.1:587");
  });

  it("says a port is not in this build rather than showing an untested tick", async () => {
    const [result] = await runConnectionTests([
      notInThisBuild("channel", "Phase 5"),
    ]);
    expect(result?.outcome).toBe("unavailable");
    expect(result?.detail).toMatch(/Phase 5/);
  });

  it("proves the database is reachable and migrated", async () => {
    const wb = await workerDb();
    const [result] = await runConnectionTests([databaseProbe(wb.appPool)]);
    expect(result?.outcome).toBe("ok");
    expect(result?.detail).toMatch(/PostgreSQL/);
  });

  it("calls the console transport a success, not a missing driver", async () => {
    // A fresh instance with no SMTP server is correctly configured. Showing a
    // warning for the state most installs are in would train operators to
    // ignore the warnings.
    const [result] = await runConnectionTests([
      mailProbe({ configured: false }),
    ]);
    expect(result?.outcome).toBe("ok");
    expect(result?.detail).toMatch(/in-app inbox/);
  });

  it("reports a mail server that refuses", async () => {
    const [result] = await runConnectionTests([
      mailProbe({
        configured: true,
        verify: async () => ({ ok: false, message: "ECONNREFUSED" }),
        host: "smtp.example.com",
      }),
    ]);
    expect(result?.outcome).toBe("failed");
  });
});

describe("what blocks finishing setup", () => {
  it("is a failing database", async () => {
    const tests = await runConnectionTests([
      {
        port: "database",
        run: async () => ({ outcome: "failed", detail: "x" }),
      },
    ]);
    expect(blockingFailures(tests)).toHaveLength(1);
  });

  it("is not mail, which is optional by §4.2", async () => {
    // With no mail, delivery stays in the in-app inbox. An operator who cannot
    // reach their mail server should still get a working instance.
    const tests = await runConnectionTests([
      { port: "mail", run: async () => ({ outcome: "failed", detail: "x" }) },
    ]);
    expect(blockingFailures(tests)).toHaveLength(0);
  });

  it("is not a port that has no driver yet", async () => {
    const tests = await runConnectionTests([
      notInThisBuild("ai", "Phase 6"),
      notInThisBuild("channel", "Phase 5"),
    ]);
    expect(blockingFailures(tests)).toHaveLength(0);
  });
});

describe("completing setup", () => {
  it("stores the settings and records completion", async () => {
    const wb = await workerDb();
    const result = await completeSetup(wb.appPool, ring, {
      settings: [{ key: "instance.name", value: "Acme OKR" }],
    });

    expect(result.claimed).toBe(true);
    expect(await readSetting(wb.appPool, "instance.name")).toBe("Acme OKR");
    expect((await readSetupState(wb.appPool)).configured).toBe(true);
  });

  it("seals a secret on the way in", async () => {
    const wb = await workerDb();
    await completeSetup(wb.appPool, ring, {
      settings: [{ key: "mail.password", secret: "hunter2" }],
    });

    const dump = await wb.admin.query(
      "select row_to_json(t)::text as dump from system_settings t where key = 'mail.password'",
    );
    expect(dump.rows[0]?.dump).not.toContain("hunter2");
  });

  it("marks settings as coming from the wizard", async () => {
    const wb = await workerDb();
    await completeSetup(wb.appPool, ring, {
      settings: [{ key: "instance.name", value: "Acme" }],
    });

    const row = await wb.admin.query(
      "select source from system_settings where key = 'instance.name'",
    );
    expect(row.rows[0]?.source).toBe("wizard");
  });

  it("refuses to claim an instance twice", async () => {
    const wb = await workerDb();
    const first = await completeSetup(wb.appPool, ring, {
      settings: [{ key: "instance.name", value: "First" }],
    });
    const second = await completeSetup(wb.appPool, ring, {
      settings: [{ key: "instance.name", value: "Second" }],
    });

    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
    // The second call changed nothing, which is what makes the wizard safe to
    // refresh.
    expect(await readSetting(wb.appPool, "instance.name")).toBe("First");
  });

  it("claims once when two wizards finish at the same moment", async () => {
    const wb = await workerDb();
    const [a, b] = await Promise.all([
      completeSetup(wb.appPool, ring, {
        settings: [{ key: "instance.name", value: "A" }],
      }),
      completeSetup(wb.appPool, ring, {
        settings: [{ key: "instance.name", value: "B" }],
      }),
    ]);

    expect([a.claimed, b.claimed].filter(Boolean)).toHaveLength(1);
  });
});

describe("registration after setup", () => {
  it("is open on a fresh instance", async () => {
    const wb = await workerDb();
    expect(await isRegistrationOpen(wb.appPool)).toBe(true);
  });

  it("closes when the wizard asks it to", async () => {
    const wb = await workerDb();
    await completeSetup(wb.appPool, ring, {
      settings: [],
      closeRegistration: true,
    });
    expect(await isRegistrationOpen(wb.appPool)).toBe(false);
  });

  it("can be forced open by an operator running a public instance", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "insert into users (id, name, email) values ('u', 'A', 'a@example.com')",
    );
    // Claimed, so 'auto' would close it.
    expect(await isRegistrationOpen(wb.appPool)).toBe(false);

    await completeSetup(wb.appPool, ring, {
      settings: [{ key: "registration.policy", value: "open" }],
    });
    expect(await isRegistrationOpen(wb.appPool)).toBe(true);
  });

  it("falls back to the computed answer on an unrecognised policy", async () => {
    // A typo in a settings row must not take the sign-in page down.
    const wb = await workerDb();
    await completeSetup(wb.appPool, ring, {
      settings: [{ key: "registration.policy", value: "sometimes" }],
    });
    expect(await isRegistrationOpen(wb.appPool)).toBe(true);
  });
});
