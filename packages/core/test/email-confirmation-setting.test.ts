import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  readEmailVerificationMode,
  resolveEmailConfirmation,
  setEmailVerificationMode,
  setEmailVerificationModeAsOperator,
} from "../src/auth/signup-policy.ts";
import { verifyEmailMail } from "../src/mail/account.ts";
import { grantOperator } from "../src/operator/grants.ts";
import { newRootKey, parseKeyRing } from "../src/secrets/key-ring.ts";

/**
 * Turning email confirmation off (plan 0.8.0 S4,
 * docs/design/email-verification.md §11).
 */

const ADMIN = "confirm-admin";
const OPERATOR = "confirm-operator";
const ring = parseKeyRing({ current: newRootKey() });
const NO_ENV: Record<string, string | undefined> = {};

const setting = async (key: string, value: unknown) => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into system_settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value",
    [key, JSON.stringify(value)],
  );
};

const instanceEvents = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ payload: Record<string, unknown> }>(
    "select payload from instance_audit_events where action = 'instance.email_verification_set' order by seq",
  );
  return rows.map((row) => row.payload);
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query("truncate table instance_audit_events");
  for (const id of [ADMIN, OPERATOR]) {
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $1, $2) on conflict do nothing",
      [id, `${id}@example.com`],
    );
  }
  // An instance that can deliver mail, so `auto` requires confirmation.
  await setting("mail.transport", "smtp");
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("what is required", () => {
  it("auto is today's rule: required exactly when mail can arrive", async () => {
    const wb = await workerDb();
    expect(await resolveEmailConfirmation(wb.appPool, NO_ENV)).toMatchObject({
      mode: "auto",
      required: true,
      linksCanArrive: true,
    });
    await setting("mail.transport", "console");
    expect(await resolveEmailConfirmation(wb.appPool, NO_ENV)).toMatchObject({
      required: false,
      linksCanArrive: false,
    });
  });

  it("off lets a new account in at once, with links still able to arrive", async () => {
    const wb = await workerDb();
    await setting("auth.emailVerification", "off");
    expect(await resolveEmailConfirmation(wb.appPool, NO_ENV)).toMatchObject({
      mode: "off",
      required: false,
      linksCanArrive: true,
    });
  });

  it("company domains keeps it required whatever the setting says (Q13)", async () => {
    const wb = await workerDb();
    await setting("auth.emailVerification", "off");
    await setting("registration.policy", "company_domains");
    expect(await resolveEmailConfirmation(wb.appPool, NO_ENV)).toMatchObject({
      required: true,
      heldByCompanyDomains: true,
      companyDomains: true,
    });
  });

  it("reads the variable when nothing is saved, and a saved value wins", async () => {
    const wb = await workerDb();
    const env = { OPENOKR_EMAIL_VERIFICATION: "off" };
    expect((await readEmailVerificationMode(wb.appPool, env)).value).toBe(
      "off",
    );
    await setting("auth.emailVerification", "auto");
    expect((await readEmailVerificationMode(wb.appPool, env)).value).toBe(
      "auto",
    );
  });
});

describe("who may change it", () => {
  it("an administrator off a cloud, audited on the instance chain", async () => {
    const wb = await workerDb();
    expect(
      await setEmailVerificationMode(
        wb.appPool,
        ring,
        { mode: "off", userId: ADMIN, workspaceId: "w" },
        NO_ENV,
      ),
    ).toBe("changed");
    expect(await instanceEvents()).toEqual([
      { from: "auto", to: "off", userId: ADMIN, workspaceId: "w" },
    ]);
  });

  it("not an administrator on a cloud (Q12)", async () => {
    const wb = await workerDb();
    await setting("cloud.enabled", true);
    await expect(
      setEmailVerificationMode(
        wb.appPool,
        ring,
        { mode: "off", userId: ADMIN, workspaceId: "w" },
        NO_ENV,
      ),
    ).rejects.toThrow(/the operator decides/);
  });

  it("the operator, and nobody without the grant", async () => {
    const wb = await workerDb();
    await expect(
      setEmailVerificationModeAsOperator(
        wb.appPool,
        ring,
        { mode: "off", operatorUserId: OPERATOR },
        NO_ENV,
      ),
    ).rejects.toThrow(/No such setting/);
    await grantOperator(wb.appPool, {
      email: `${OPERATOR}@example.com`,
      grantedByEmail: `${ADMIN}@example.com`,
    });
    expect(
      await setEmailVerificationModeAsOperator(
        wb.appPool,
        ring,
        { mode: "off", operatorUserId: OPERATOR },
        NO_ENV,
      ),
    ).toBe("changed");
    expect(await instanceEvents()).toEqual([
      { from: "auto", to: "off", operatorUserId: OPERATOR },
    ]);
  });

  it("refuses off under company domains, saying why", async () => {
    const wb = await workerDb();
    await setting("registration.policy", "company_domains");
    await expect(
      setEmailVerificationMode(
        wb.appPool,
        ring,
        { mode: "off", userId: ADMIN, workspaceId: "w" },
        NO_ENV,
      ),
    ).rejects.toThrow(/limited to your company's domains/);
    expect(await instanceEvents()).toEqual([]);
  });
});

describe("the mail with confirmation off (§11.3)", () => {
  it("offers the link rather than asking for it", () => {
    const mail = verifyEmailMail({
      instanceName: "Northwind OKRs",
      locale: "en",
      to: "priya@northwind.example",
      url: "https://okr.example/api/auth/verify-email?token=x",
      hours: 24,
      optional: true,
    });
    expect(mail.subject).toBe("Your account on Northwind OKRs is ready");
    expect(mail.text).toContain("You can use your account now.");
    expect(mail.text).not.toMatch(/to finish setting up/);
  });
});
