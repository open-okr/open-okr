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

  it("refuses an unrecognised transport instead of falling back to console", async () => {
    // **This test asserted the opposite until 11 September 2026**, with the
    // comment "a typo in a settings row must not take password reset down
    // with it." The P7-T08a privacy review weighed the other side of that
    // trade: a typo does not take password reset down, it moves password
    // reset into the process log along with every address and every live
    // reset link, because the console driver writes each message to stdout.
    // Down is visible and gets fixed within the hour; this is invisible and
    // can run for a quarter. Agung chose the refusal, because it changes
    // what a misconfigured live instance does.
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [
      { key: "mail.transport", value: "carrier-pigeon" },
    ]);

    await expect(resolveMailSettings(wb.appPool, ring, {})).rejects.toThrow(
      /carrier-pigeon/,
    );
  });
});

/**
 * Absent and wrong stop meaning the same thing (P7-T08d).
 *
 * This resolver used to fall back to `console` for any value it did not
 * recognise, with the reason written beside it: "a typo in a settings row
 * must not take password reset down with it." It was a deliberate trade and
 * its privacy cost was not part of it. A typo does not take password reset
 * down; it moves password reset into the process log along with every
 * address and every live reset link, because the console driver writes each
 * message to stdout. Down is visible and gets fixed within the hour. This is
 * invisible and can run for a quarter.
 */
describe("an unrecognised transport is refused", () => {
  it("refuses a typo and names the setting", async () => {
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [
      { key: "mail.transport", value: "smpt" },
    ]);

    await expect(resolveMailSettings(wb.appPool, ring, {})).rejects.toThrow(
      /mail\.transport/,
    );
  });

  it("says what to do instead, because a refusal with no way out is a wall", async () => {
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [
      { key: "mail.transport", value: "sendgrid" },
    ]);

    await expect(resolveMailSettings(wb.appPool, ring, {})).rejects.toThrow(
      /"smtp" to send, or "console"/,
    );
  });

  it("still falls back to console when nothing is set", async () => {
    // The half that must not change. An unset transport is "not configured
    // yet", and console is what lets a fresh checkout run the first-run
    // wizard with no mail server anywhere.
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [
      { key: "mail.transport", value: "" },
    ]);

    const settings = await resolveMailSettings(wb.appPool, ring, {});
    expect(settings.transport).toBe("console");
  });

  it("leaves a valid transport alone", async () => {
    const wb = await workerDb();
    await writeSettings(wb.appPool, ring, [
      { key: "mail.transport", value: "smtp" },
    ]);

    const settings = await resolveMailSettings(wb.appPool, ring, {});
    expect(settings.transport).toBe("smtp");
  });

  it("refuses a typo in the environment too, not only in a stored row", async () => {
    // The environment is the bootstrap half of the §4.14 map, and a
    // misspelt variable in a compose file is at least as likely as a
    // misspelt settings row.
    const wb = await workerDb();

    await expect(
      resolveMailSettings(wb.appPool, ring, {
        OPENOKR_MAIL_TRANSPORT: "SMTP",
      }),
    ).rejects.toThrow(/mail\.transport/);
  });
});
