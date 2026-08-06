import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readSecret, writeSettings } from "../src/secrets/instance-settings.ts";
import {
  KeyRingError,
  newRootKey,
  parseKeyRing,
} from "../src/secrets/key-ring.ts";
import { rotateInstanceSecrets } from "../src/secrets/rotate.ts";

/**
 * Root key rotation against real stored secrets.
 *
 * The property that matters is that no secret becomes unreadable. A rotation
 * that loses one credential has lost it permanently, so this exercises the
 * interrupted case as well as the clean one.
 */

const FIRST = newRootKey();
const SECOND = newRootKey();

const oldRing = parseKeyRing({ current: FIRST });
const rotatingRing = parseKeyRing({ current: SECOND, previous: [FIRST] });
const newRingOnly = parseKeyRing({ current: SECOND });

beforeEach(async () => {
  const wb = await workerDb();
  await wb.admin.query("delete from system_settings");
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

const seed = async () => {
  const wb = await workerDb();
  await writeSettings(wb.appPool, oldRing, [
    { key: "mail.password", secret: "smtp-secret" },
    { key: "ai.key", secret: "provider-secret" },
    { key: "instance.name", value: "Acme" },
  ]);
  return wb;
};

describe("rotating", () => {
  it("re-wraps every sealed secret and leaves plain settings alone", async () => {
    const wb = await seed();
    const report = await rotateInstanceSecrets(wb.appPool, rotatingRing);

    expect(report.examined).toBe(2);
    expect(report.rewrapped).toBe(2);
    expect(report.current).toBe(0);
  });

  it("leaves every secret readable under the new key alone", async () => {
    // The point of the whole exercise: once rotation finishes, the old key can
    // be thrown away.
    const wb = await seed();
    await rotateInstanceSecrets(wb.appPool, rotatingRing);

    expect(await readSecret(wb.appPool, newRingOnly, "mail.password")).toBe(
      "smtp-secret",
    );
    expect(await readSecret(wb.appPool, newRingOnly, "ai.key")).toBe(
      "provider-secret",
    );
  });

  it("does not change the secret's own ciphertext", async () => {
    // Rotation re-wraps data keys only. Rewriting ciphertext would mean
    // decrypting every credential, which is exactly what envelope encryption
    // exists to avoid.
    const wb = await seed();
    const before = await wb.admin.query(
      "select secret_ciphertext from system_settings where key = 'mail.password'",
    );
    await rotateInstanceSecrets(wb.appPool, rotatingRing);
    const after = await wb.admin.query(
      "select secret_ciphertext from system_settings where key = 'mail.password'",
    );

    expect(after.rows[0]?.secret_ciphertext).toBe(
      before.rows[0]?.secret_ciphertext,
    );
  });

  it("does nothing on a second run", async () => {
    const wb = await seed();
    await rotateInstanceSecrets(wb.appPool, rotatingRing);
    const second = await rotateInstanceSecrets(wb.appPool, rotatingRing);

    expect(second.rewrapped).toBe(0);
    expect(second.current).toBe(2);
  });

  it("leaves an unrotated instance readable, so an interrupted run is safe", async () => {
    // Simulates dying after one secret: the remaining one is still on the old
    // key, and the ring still holds it.
    const wb = await seed();
    await writeSettings(wb.appPool, rotatingRing, [
      { key: "mail.password", secret: "smtp-secret" },
    ]);

    expect(await readSecret(wb.appPool, rotatingRing, "mail.password")).toBe(
      "smtp-secret",
    );
    expect(await readSecret(wb.appPool, rotatingRing, "ai.key")).toBe(
      "provider-secret",
    );
  });

  it("refuses to read an old secret once the old key leaves the ring", async () => {
    // The failure an operator must never hit by accident, proven to be a loud
    // error rather than a silently empty value.
    const wb = await seed();
    await expect(
      readSecret(wb.appPool, newRingOnly, "mail.password"),
    ).rejects.toThrow(KeyRingError);
  });

  it("reports nothing to do on an instance with no secrets", async () => {
    const wb = await workerDb();
    await writeSettings(wb.appPool, oldRing, [
      { key: "instance.name", value: "Acme" },
    ]);

    const report = await rotateInstanceSecrets(wb.appPool, rotatingRing);
    expect(report).toEqual({ examined: 0, rewrapped: 0, current: 0 });
  });
});
