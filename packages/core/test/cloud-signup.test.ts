import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { resolveRequireEmailVerification } from "../src/auth/signup-policy.ts";
import { writeSettings } from "../src/secrets/instance-settings.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";
import { CLOUD_ENABLED_KEY } from "../src/tenancy/index.ts";
import { isRegistrationOpen } from "../src/workspaces/registration.ts";

/**
 * Cloud signup (P8-T02b, design in
 * `docs/design/p8-t01a-tenant-lifecycle.md` §4).
 *
 * Two rules, and neither may change what a self-hosted instance does.
 */

const ring = parseKeyRing({ current: newRootKey() });

const claimInstance = async () => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    ["claimer", "The Claimer", "claimer@example.com"],
  );
};

const setSetting = async (key: string, value: unknown) => {
  const wb = await workerDb();
  await writeSettings(wb.appPool, ring, [{ key, value }]);
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query("delete from system_settings");
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("registration on a self-hosted instance, unchanged", () => {
  it("is open while nobody has claimed it", async () => {
    const wb = await workerDb();
    await expect(isRegistrationOpen(wb.appPool)).resolves.toBe(true);
  });

  it("closes once somebody has", async () => {
    const wb = await workerDb();
    await claimInstance();
    await expect(isRegistrationOpen(wb.appPool)).resolves.toBe(false);
  });
});

describe("registration on a cloud instance", () => {
  it("stays open after the instance is claimed", async () => {
    // The computed answer exists because a self-hosted instance belongs to
    // whoever set it up. A cloud belongs to nobody, so the first signup must
    // not close the door behind itself.
    const wb = await workerDb();
    await setSetting(CLOUD_ENABLED_KEY, true);
    await claimInstance();
    await expect(isRegistrationOpen(wb.appPool)).resolves.toBe(true);
  });

  it("is still closed when an operator says invitation-only", async () => {
    // An explicit setting beats a computed default, which is already true of
    // 'open' and 'invite_only' on a self-hosted instance. A cloud operator
    // closing signups during an incident must actually close them.
    const wb = await workerDb();
    await setSetting(CLOUD_ENABLED_KEY, true);
    await setSetting("registration.policy", "invite_only");
    await expect(isRegistrationOpen(wb.appPool)).resolves.toBe(false);
  });
});

describe("whether a sign-in must wait for a verified address", () => {
  it("does not require it when mail goes to the console", async () => {
    // The reason `requireEmailVerification` has been false since P1-T05: a
    // first run with no mail server would block the first login on a link
    // nobody can receive.
    const wb = await workerDb();
    await expect(resolveRequireEmailVerification(wb.appPool)).resolves.toBe(
      false,
    );
  });

  it("requires it as soon as the instance can actually send mail", async () => {
    // Agung chose this over tying it to the cloud flag on 14 September 2026.
    // An instance with real SMTP gets verification whether it is a cloud or
    // somebody's own server, which is the better rule: the thing that
    // decides is whether the link can arrive.
    const wb = await workerDb();
    await setSetting("mail.transport", "smtp");
    await expect(resolveRequireEmailVerification(wb.appPool)).resolves.toBe(
      true,
    );
  });

  it("does not require it for an unrecognised transport", async () => {
    // P7-T08d made an unrecognised transport refuse and name the setting
    // rather than fall back silently. Whatever that refusal does, it must
    // not be reached by locking everybody out of sign-in first.
    const wb = await workerDb();
    await setSetting("mail.transport", "smpt");
    await expect(resolveRequireEmailVerification(wb.appPool)).resolves.toBe(
      false,
    );
  });
});
