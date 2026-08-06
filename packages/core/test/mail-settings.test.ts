import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { writeSettings } from "../src/secrets/instance-settings.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import { resolveMailSettings } from "../src/secrets/mail-settings.ts";

/**
 * Mail settings resolution (P1-T09).
 *
 * This is the read side of the §4.14 map for mail: stored value first, then
 * the environment as bootstrap, then the registry default. The password comes
 * out of the sealed columns, so this is also where the key ring meets a real
 * consumer.
 */

const ring = parseKeyRing({ current: newRootKey() });

beforeEach(async () => {
  const wb = await workerDb();
  await wb.admin.query("delete from system_settings");
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("resolveMailSettings", () => {
  it("defaults to the console transport with nothing configured anywhere", async () => {
    const wb = await workerDb();
    const settings = await resolveMailSettings(wb.appPool, ring, {});

    expect(settings.transport).toBe("console");
  });

  it("bootstraps from the environment", async () => {
    const wb = await workerDb();
    const settings = await resolveMailSettings(wb.appPool, ring, {
      OPENOKR_MAIL_TRANSPORT: "smtp",
      OPENOKR_MAIL_HOST: "smtp.example.com",
      OPENOKR_MAIL_PORT: "2525",
      OPENOKR_MAIL_USER: "postmaster",
      OPENOKR_MAIL_PASSWORD: "env-secret",
      OPENOKR_MAIL_FROM: "okr@example.com",
    });

    expect(settings).toMatchObject({
      transport: "smtp",
      host: "smtp.example.com",
      port: 2525,
      secure: false,
      user: "postmaster",
      password: "env-secret",
      from: "okr@example.com",
    });
  });

  it("prefers a stored value over the environment", async () => {
    // The environment is bootstrap, not an override: a host changed in the
    // product must survive a restart with the old variable still set.
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [
      { key: "mail.host", value: "stored.example.com" },
    ]);

    const settings = await resolveMailSettings(wb.appPool, ring, {
      OPENOKR_MAIL_TRANSPORT: "smtp",
      OPENOKR_MAIL_HOST: "env.example.com",
    });

    expect(settings.transport).toBe("smtp");
    expect(settings.host).toBe("stored.example.com");
  });

  it("opens a stored password through the key ring", async () => {
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [
      { key: "mail.transport", value: "smtp" },
      { key: "mail.host", value: "smtp.example.com" },
      { key: "mail.password", secret: "stored-secret" },
    ]);

    const settings = await resolveMailSettings(wb.appPool, ring, {
      OPENOKR_MAIL_PASSWORD: "env-secret",
    });

    // The sealed value wins over the environment, like every other setting.
    expect(settings.password).toBe("stored-secret");
  });

  it("reports where the transport decision came from", async () => {
    const wb = await workerDb();
    const fromDefault = await resolveMailSettings(wb.appPool, ring, {});
    expect(fromDefault.source).toBe("default");

    const fromEnv = await resolveMailSettings(wb.appPool, ring, {
      OPENOKR_MAIL_TRANSPORT: "smtp",
      OPENOKR_MAIL_HOST: "smtp.example.com",
    });
    expect(fromEnv.source).toBe("environment");
  });

  it("falls back to console on an unrecognised transport rather than failing the caller", async () => {
    // A typo in a settings row must not take password reset down with it.
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [
      { key: "mail.transport", value: "carrier-pigeon" },
    ]);

    const settings = await resolveMailSettings(wb.appPool, ring, {});
    expect(settings.transport).toBe("console");
  });
});
