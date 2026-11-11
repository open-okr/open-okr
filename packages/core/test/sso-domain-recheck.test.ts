import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { recheckSSODomains } from "../src/auth/sso-domain-recheck.ts";
import {
  DOMAIN_FAILURE_LIMIT,
  hashVerificationToken,
} from "../src/auth/sso-domains.ts";
import {
  auditActions,
  domainRow,
  FakeDns,
  seedVerifiedDomain,
  workspaceFor,
} from "./sso-domain-fixtures.ts";

/**
 * The daily re-check (docs/design/sso-domain-verification.md, "The record" and
 * rule 7).
 *
 * Three failed checks in a row take a domain back to unverified, a success
 * puts the count back to nothing, and a resolver that did not answer counts
 * as neither.
 */

let ws: string;
let dns: FakeDns;

const TOKEN = "a-token";
const NAME = "_openokr-verify.example.com";

const recheck = async () => {
  const wb = await workerDb();
  return recheckSSODomains(wb.appPool, ws, dns);
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  ws = await workspaceFor("owner-a", "Workspace A");
  dns = new FakeDns();
  await seedVerifiedDomain(ws, "example.com", {
    tokenHash: hashVerificationToken(TOKEN),
  });
});

afterAll(async () => {
  await (await workerDb()).close();
});

describe("the daily re-check", () => {
  it("keeps a domain whose record is still there, and writes nothing to audit", async () => {
    dns.publish(NAME, `openokr-verify=${TOKEN}`);

    const result = await recheck();

    expect(result).toMatchObject({ checked: 1, failed: 0, unverified: 0 });
    const row = await domainRow(ws, "example.com");
    expect(row?.verified_at).not.toBeNull();
    expect(row?.last_checked_at).not.toBeNull();
    expect(await auditActions()).toEqual([]);
  });

  it("counts a missing record, audits each failure, and unverifies on the third", async () => {
    expect(DOMAIN_FAILURE_LIMIT).toBe(3);

    await recheck();
    await recheck();
    expect(await domainRow(ws, "example.com")).toMatchObject({
      failed_checks: 2,
    });
    expect((await domainRow(ws, "example.com"))?.verified_at).not.toBeNull();

    const third = await recheck();

    expect(third.unverified).toBe(1);
    const row = await domainRow(ws, "example.com");
    expect(row?.verified_at).toBeNull();
    expect(row?.verified_by).toBeNull();
    expect(row?.failed_checks).toBe(0);
    expect(await auditActions()).toEqual([
      "sso.domainCheckFailed",
      "sso.domainCheckFailed",
      "sso.domainUnverified",
    ]);
  });

  it("treats a record with another token as a failed check", async () => {
    dns.publish(NAME, "openokr-verify=somebody-elses");

    const result = await recheck();

    expect(result.failed).toBe(1);
  });

  it("puts the count back after a success, and audits the recovery", async () => {
    await recheck();
    await recheck();
    dns.publish(NAME, `openokr-verify=${TOKEN}`);

    await recheck();

    expect((await domainRow(ws, "example.com"))?.failed_checks).toBe(0);
    expect(await auditActions()).toContain("sso.domainCheckRecovered");
    // So the next gap starts from nothing, not from two.
    dns.remove(NAME);
    await recheck();
    expect((await domainRow(ws, "example.com"))?.failed_checks).toBe(1);
  });

  it("does not count a resolver that did not answer", async () => {
    dns.fail();

    const result = await recheck();
    await recheck();
    await recheck();
    await recheck();

    expect(result).toMatchObject({ failed: 0, unavailable: 1 });
    const row = await domainRow(ws, "example.com");
    expect(row?.failed_checks).toBe(0);
    expect(row?.verified_at).not.toBeNull();
  });

  it("leaves a domain an administrator marked by hand alone", async () => {
    await seedVerifiedDomain(ws, "airgap.example", { verifiedBy: "user-9" });

    for (let i = 0; i < 4; i += 1) {
      await recheck();
    }

    const row = await domainRow(ws, "airgap.example");
    expect(row?.verified_at).not.toBeNull();
    expect(row?.failed_checks).toBe(0);
  });

  it("lists the domain as failing while it is on its way out", async () => {
    await recheck();
    const { callAction } = await import("../src/actions/registry.ts");
    const { asOwner } = await import("./sso-domain-fixtures.ts");

    const [listed] = await callAction(
      await asOwner("owner-a", ws),
      "sso.listDomains",
      {},
    );

    expect(listed).toMatchObject({ status: "failing", failedChecks: 1 });
  });
});
