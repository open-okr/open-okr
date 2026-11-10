import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { hashVerificationToken } from "../src/auth/sso-domains.ts";
import {
  asOwner,
  auditActions,
  domainRow,
  FakeDns,
  seedVerifiedDomain,
  workspaceFor,
} from "./sso-domain-fixtures.ts";

/**
 * An administrator re-checks a verified domain whose daily check is failing
 * (docs/design/sso-domain-verification.md, "Screens"). A match recovers it. A
 * miss changes nothing, so a manual check cannot speed up unverifying.
 */

let ws: string;
let dns: FakeDns;

const TOKEN = "a-token";
const NAME = "_openokr-verify.example.com";

const verify = async () =>
  callAction(await asOwner("owner-a", ws, dns), "sso.verifyDomain", {
    domain: "example.com",
  });

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  ws = await workspaceFor("owner-a", "Workspace A");
  dns = new FakeDns();
});

afterAll(async () => {
  await (await workerDb()).close();
});

describe("re-checking a domain whose daily check is failing", () => {
  it("resets the count and the check time when the record is back, and audits it", async () => {
    await seedVerifiedDomain(ws, "example.com", {
      tokenHash: hashVerificationToken(TOKEN),
      failedChecks: 2,
    });
    dns.publish(NAME, `openokr-verify=${TOKEN}`);

    const result = await verify();

    expect(result).toEqual({
      domain: "example.com",
      verified: true,
      reason: null,
    });
    const row = await domainRow(ws, "example.com");
    expect(row?.failed_checks).toBe(0);
    expect(row?.verified_at).not.toBeNull();
    expect(row?.verified_by).toBe("dns");
    expect(row?.last_checked_at).not.toBeNull();
    expect(await auditActions()).toEqual(["sso.domainCheckRecovered"]);
  });

  it("leaves the row as it was when the record is still missing, wrong or the resolver is down", async () => {
    await seedVerifiedDomain(ws, "example.com", {
      tokenHash: hashVerificationToken(TOKEN),
      failedChecks: 2,
    });
    const before = await domainRow(ws, "example.com");

    expect(await verify()).toMatchObject({
      verified: false,
      reason: "record_missing",
    });
    dns.publish(NAME, "openokr-verify=somebody-elses");
    expect(await verify()).toMatchObject({
      verified: false,
      reason: "record_mismatch",
    });
    dns.fail();
    expect(await verify()).toMatchObject({
      verified: false,
      reason: "lookup_failed",
    });

    expect(await domainRow(ws, "example.com")).toEqual(before);
  });

  it("still answers at once for a verified domain with no failed check, without looking", async () => {
    await seedVerifiedDomain(ws, "example.com", {
      tokenHash: hashVerificationToken(TOKEN),
    });
    dns.fail();

    expect(await verify()).toEqual({
      domain: "example.com",
      verified: true,
      reason: null,
    });
    expect((await domainRow(ws, "example.com"))?.last_checked_at).toBeNull();
  });
});
