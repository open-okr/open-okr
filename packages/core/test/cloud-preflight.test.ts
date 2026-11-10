import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readCloudPreflight } from "../src/operator/preflight.ts";

/**
 * The warnings on the operator's Instance page (S-47). They only ever warn:
 * the loader answers a list, and nothing that reads it can refuse anything.
 */

const KEYS = [
  "cloud.enabled",
  "mail.transport",
  "instance.termsUrl",
  "instance.privacyUrl",
  "cloud.closureRetentionDays",
];
const ENVIRONMENT = [
  "OPENOKR_CLOUD_ENABLED",
  "OPENOKR_MAIL_TRANSPORT",
  "OPENOKR_TERMS_URL",
  "OPENOKR_PRIVACY_URL",
  "OPENOKR_CLOUD_CLOSURE_RETENTION_DAYS",
];

const set = async (key: string, value: unknown) => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into system_settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value",
    [key, JSON.stringify(value)],
  );
};

/** A cloud with everything in place, so each test breaks exactly one thing. */
const readyCloud = async () => {
  await set("cloud.enabled", true);
  await set("mail.transport", "smtp");
  await set("instance.termsUrl", "https://cloud.example/terms");
  await set("instance.privacyUrl", "https://cloud.example/privacy");
  await set("cloud.closureRetentionDays", 30);
};

const warnings = async () => readCloudPreflight((await workerDb()).appPool);

beforeEach(async () => {
  for (const name of ENVIRONMENT) {
    delete process.env[name];
  }
  const wb = await workerDb();
  await wb.admin.query("delete from system_settings where key = any($1)", [
    KEYS,
  ]);
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.admin.query("delete from system_settings where key = any($1)", [
    KEYS,
  ]);
  await wb.close();
});

describe("the cloud preflight", () => {
  it("says nothing on an instance that is not a cloud", async () => {
    expect(await warnings()).toEqual([]);
  });

  it("says nothing when everything is in place", async () => {
    await readyCloud();
    expect(await warnings()).toEqual([]);
  });

  it("warns when mail only goes to the console", async () => {
    await readyCloud();
    await set("mail.transport", "console");
    expect(await warnings()).toEqual(["mail_console"]);
  });

  it("warns when the terms address is empty", async () => {
    await readyCloud();
    await set("instance.termsUrl", "");
    expect(await warnings()).toEqual(["terms_missing"]);
  });

  it("warns when the privacy address is empty", async () => {
    await readyCloud();
    await set("instance.privacyUrl", "  ");
    expect(await warnings()).toEqual(["privacy_missing"]);
  });

  it("warns when closed workspaces are never erased", async () => {
    await readyCloud();
    await set("cloud.closureRetentionDays", 0);
    expect(await warnings()).toEqual(["retention_zero"]);
  });

  it("lists every warning on a cloud that is left at its defaults", async () => {
    await set("cloud.enabled", true);
    expect(await warnings()).toEqual([
      "mail_console",
      "terms_missing",
      "privacy_missing",
      "retention_zero",
    ]);
  });
});
