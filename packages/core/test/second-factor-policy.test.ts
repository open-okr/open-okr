import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import {
  ENROLMENT_PATH,
  heldForEnrolment,
  identityProviderManaged,
  requiresSecondFactor,
} from "../src/auth/second-factor.ts";
import { resolveWorkspaceSettings } from "../src/settings/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The organisation-mandated second factor (P8-T09).
 *
 * The factors have shipped since P1-T05. What is new is a workspace saying
 * everybody holds one, and members who do not being held in the enrolment
 * screen rather than asked and ignored.
 *
 * The hold itself is a redirect in the shell every authenticated screen goes
 * through, and what is tested here is the decision that redirect is made on:
 * who is held, where they may still go, and who is exempt.
 */

let workspaceId: string;

beforeAll(async () => {
  const wb = await workerDb();
  await wb.admin.query(
    `insert into users (id, name, email, email_verified, created_at, updated_at)
     values ('mfa-owner', 'Owner', 'owner@mfa.test', true, now(), now()),
            ('mfa-sso', 'SSO Person', 'sso@mfa.test', true, now(), now())
     on conflict (id) do nothing`,
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, {
      id: "mfa-owner",
      name: "MFA Workspace",
    })
  ).workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("who is held in enrolment", () => {
  const base = {
    required: true,
    enrolled: false,
    identityProviderManaged: false,
    path: "/goals",
  };

  it("holds a member the policy covers who has no second factor", () => {
    expect(heldForEnrolment(base)).toBe(true);
  });

  it("holds nobody when the workspace has not asked", () => {
    expect(heldForEnrolment({ ...base, required: false })).toBe(false);
  });

  it("holds nobody who already has one", () => {
    expect(heldForEnrolment({ ...base, enrolled: true })).toBe(false);
  });

  it("exempts an account an identity provider manages", () => {
    // The provider enforces the organisation's own second factor. A second
    // one held here is a factor the organisation cannot administer or reset.
    expect(heldForEnrolment({ ...base, identityProviderManaged: true })).toBe(
      false,
    );
  });

  it("lets a held member reach enrolment, or the hold is a loop", () => {
    expect(heldForEnrolment({ ...base, path: ENROLMENT_PATH })).toBe(false);
    expect(
      heldForEnrolment({ ...base, path: `${ENROLMENT_PATH}/anything` }),
    ).toBe(false);
  });

  it("lets a held member sign out, because a policy is not a trap", () => {
    expect(heldForEnrolment({ ...base, path: "/sign-out" })).toBe(false);
  });

  it("holds every other screen, including the front door", () => {
    for (const path of ["/", "/goals", "/admin/general", "/account/channels"]) {
      expect(heldForEnrolment({ ...base, path })).toBe(true);
    }
  });
});

describe("the workspace setting", () => {
  it("is off on a workspace nobody configured", async () => {
    const wb = await workerDb();
    expect(resolveWorkspaceSettings({}).requireSecondFactor).toBe(false);
    expect(await requiresSecondFactor(wb.appPool, workspaceId)).toBe(false);
  });

  it("turns on through the settings action and is read back", async () => {
    const wb = await workerDb();

    await callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human", userId: "mfa-owner" },
      },
      "settings.updateWorkspaceGeneral",
      { requireSecondFactor: true },
    );

    expect(await requiresSecondFactor(wb.appPool, workspaceId)).toBe(true);
  });

  it("turns off again", async () => {
    const wb = await workerDb();

    await callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human", userId: "mfa-owner" },
      },
      "settings.updateWorkspaceGeneral",
      { requireSecondFactor: false },
    );

    expect(await requiresSecondFactor(wb.appPool, workspaceId)).toBe(false);
  });
});

describe("whether an identity provider manages an account", () => {
  it("is false for an account with a password", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `insert into accounts (id, user_id, account_id, provider_id, password, created_at, updated_at)
       values ('acct-password', 'mfa-owner', 'mfa-owner', 'credential', 'hashed', now(), now())
       on conflict (id) do nothing`,
    );

    expect(await identityProviderManaged(wb.appPool, "mfa-owner")).toBe(false);
  });

  it("is true for an account linked to a configured provider", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `insert into accounts (id, user_id, account_id, provider_id, created_at, updated_at)
       values ('acct-sso', 'mfa-sso', 'okta-subject', 'sso-okta-abcd1234', now(), now())
       on conflict (id) do nothing`,
    );

    expect(await identityProviderManaged(wb.appPool, "mfa-sso")).toBe(true);
  });

  it("is false for somebody with no account rows at all", async () => {
    const wb = await workerDb();
    expect(await identityProviderManaged(wb.appPool, "nobody")).toBe(false);
  });
});
