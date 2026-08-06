import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  environmentValue,
  getInstanceSetting,
  INSTANCE_SETTINGS,
  SETUP_COMPLETED_AT,
} from "../src/secrets/instance-registry.ts";
import {
  clearSetting,
  readSecret,
  readSetting,
  resolveSetting,
  writeSettings,
} from "../src/secrets/instance-settings.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import { readSetupState, setupRefusal } from "../src/setup/state.ts";

/**
 * Instance settings: the store, the registry and what "configured" means.
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

describe("the registry", () => {
  it("gives every setting a working default, so nothing must be configured", () => {
    for (const setting of INSTANCE_SETTINGS) {
      expect(setting.fallback).toBeDefined();
    }
  });

  it("defaults mail to the console transport, so a fresh instance needs no mail server", () => {
    expect(getInstanceSetting("mail.transport")?.fallback).toBe("console");
  });

  it("defaults telemetry to off", () => {
    expect(getInstanceSetting("instance.telemetry")?.fallback).toBe(false);
  });

  it("marks the mail password as a secret, so it is never stored in the clear", () => {
    expect(getInstanceSetting("mail.password")?.secret).toBe(true);
  });

  it("declares no secret without a sealed home", () => {
    // A setting marked secret is written through the sealed columns. One
    // marked secret but read back as a plain value would be stored in clear.
    for (const setting of INSTANCE_SETTINGS.filter((s) => s.secret)) {
      expect(setting.kind).toBe("string");
    }
  });
});

describe("environment bootstrap", () => {
  const definition = getInstanceSetting("mail.port");

  it("reads and coerces a number", () => {
    expect(
      environmentValue(definition as never, { OPENOKR_MAIL_PORT: "2525" }),
    ).toBe(2525);
  });

  it("ignores a number that is not one", () => {
    expect(
      environmentValue(definition as never, { OPENOKR_MAIL_PORT: "smtp" }),
    ).toBeUndefined();
  });

  it("treats a blank variable as absent, which is how containers deliver unset", () => {
    expect(
      environmentValue(definition as never, { OPENOKR_MAIL_PORT: "   " }),
    ).toBeUndefined();
  });

  it("accepts the several ways an operator writes true", () => {
    const secure = getInstanceSetting("mail.secure");
    for (const raw of ["1", "true", "YES", "on"]) {
      expect(
        environmentValue(secure as never, { OPENOKR_MAIL_SECURE: raw }),
      ).toBe(true);
    }
    expect(
      environmentValue(secure as never, { OPENOKR_MAIL_SECURE: "false" }),
    ).toBe(false);
  });
});

describe("resolution order", () => {
  it("prefers a stored value over the environment", () => {
    // The environment bootstraps an instance; it does not override what an
    // operator later chose in the product. Otherwise a setting changed in the
    // interface silently reverts on the next restart.
    expect(resolveSetting("stored", "from-env", "fallback")).toEqual({
      value: "stored",
      source: "database",
    });
  });

  it("prefers the environment over the default", () => {
    expect(resolveSetting(undefined, "from-env", "fallback")).toEqual({
      value: "from-env",
      source: "environment",
    });
  });

  it("falls back to the registry default", () => {
    expect(resolveSetting(undefined, undefined, "fallback")).toEqual({
      value: "fallback",
      source: "default",
    });
  });

  it("treats a stored null as unset, so clearing a value restores the default", () => {
    expect(resolveSetting(null, undefined, "fallback").source).toBe("default");
  });
});

describe("storing settings", () => {
  it("round-trips a plain value", async () => {
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [
      { key: "mail.host", value: "smtp.example.com" },
    ]);
    expect(await readSetting(wb.appPool, "mail.host")).toBe("smtp.example.com");
  });

  it("round-trips a secret", async () => {
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [
      { key: "mail.password", secret: "hunter2" },
    ]);
    expect(await readSecret(wb.appPool, ring, "mail.password")).toBe("hunter2");
  });

  it("never stores a secret in the clear", async () => {
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [
      { key: "mail.password", secret: "hunter2" },
    ]);

    // The whole row, as the database holds it.
    const row = await wb.admin.query(
      "select row_to_json(t)::text as dump from system_settings t where key = 'mail.password'",
    );
    expect(row.rows[0]?.dump).not.toContain("hunter2");
  });

  it("overwrites an existing setting rather than failing on the key", async () => {
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [{ key: "mail.host", value: "a" }]);
    await writeSettings(wb.appPool, ring, [{ key: "mail.host", value: "b" }]);
    expect(await readSetting(wb.appPool, "mail.host")).toBe("b");
  });

  it("writes a batch atomically", async () => {
    // A mail host stored without its password leaves an instance that tests
    // as configured and fails on the first send.
    const wb = await workerDb();
    await expect(
      writeSettings(wb.appPool, ring, [
        { key: "mail.host", value: "smtp.example.com" },
        { key: "mail.password", secret: "x" },
        // Not a string: the insert fails, and the host must not survive.
        { key: null as never, value: "boom" },
      ]),
    ).rejects.toThrow();

    expect(await readSetting(wb.appPool, "mail.host")).toBeUndefined();
  });

  it("distinguishes a secret that is absent from one that is empty", async () => {
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [{ key: "mail.host", value: "a" }]);
    expect(await readSecret(wb.appPool, ring, "mail.host")).toBeUndefined();

    await writeSettings(wb.appPool, ring, [
      { key: "mail.password", secret: "" },
    ]);
    expect(await readSecret(wb.appPool, ring, "mail.password")).toBe("");
  });

  it("clears a setting so the default applies again", async () => {
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [{ key: "mail.host", value: "a" }]);
    await clearSetting(wb.appPool, "mail.host");
    expect(await readSetting(wb.appPool, "mail.host")).toBeUndefined();
  });
});

describe("setup state", () => {
  it("reads a fresh instance as unconfigured", async () => {
    const wb = await workerDb();
    const state = await readSetupState(wb.appPool);
    expect(state.configured).toBe(false);
    expect(state.hasUser).toBe(false);
  });

  it("reads it as configured once the wizard records completion", async () => {
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [
      { key: SETUP_COMPLETED_AT, value: "2026-08-06T10:00:00.000Z" },
    ]);

    const state = await readSetupState(wb.appPool);
    expect(state.configured).toBe(true);
    expect(state.completedAt).toBe("2026-08-06T10:00:00.000Z");
  });

  it("is still unconfigured when an account exists but the wizard never finished", async () => {
    // A wizard interrupted after creating the admin must be resumable, which
    // is why completion is a recorded marker and not inferred from users.
    const wb = await workerDb();
    await wb.admin.query(
      "insert into users (id, name, email) values ('u', 'A', 'a@example.com')",
    );

    const state = await readSetupState(wb.appPool);
    expect(state.hasUser).toBe(true);
    expect(state.configured).toBe(false);
  });

  it("refuses the wizard once configured, and says why", async () => {
    const configured = { configured: true, hasUser: true };
    expect(setupRefusal(configured)).toMatch(/already been set up/i);
  });

  it("lets the wizard proceed on a fresh instance", () => {
    expect(setupRefusal({ configured: false, hasUser: false })).toBeUndefined();
  });
});
