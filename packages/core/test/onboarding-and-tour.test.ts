import { withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { PRIVATE_ACTIVITY_KINDS } from "../src/activities/catalogue.ts";
import { provisionMemberForInvite } from "../src/invitations/provisioning.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Setup offered again, and the first-visit tour (UIUX-PLAN S-34, completeness
 * review L-08).
 *
 * S-34 says two things the product did not do: "A dismissed onboarding is
 * resumable from admin", and "Per user on first visit: a five-stop tour". The
 * screens are proved in `apps/web/test/onboarding.test.ts` and in the
 * end-to-end specs. What is proved here is what each action writes, who may
 * call it, and what it leaves alone.
 */

const FOUNDER = "l08-founder";
const JOINER = "l08-joiner";

let workspaceId: string;
let founderMemberId: string;
let joinerMemberId: string;

const as = async (userId: string) => ({
  pool: (await workerDb()).appPool,
  workspaceId,
  actor: { kind: "human" as const, userId },
});

async function storedSettings(): Promise<Record<string, unknown>> {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    settings: Record<string, unknown>;
  }>("select settings from workspaces where id = $1", [workspaceId]);
  return rows[0]?.settings ?? {};
}

async function auditActions(action: string): Promise<string[]> {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ actor_member_id: string }>(
    "select actor_member_id from audit_events where workspace_id = $1 and action = $2",
    [workspaceId, action],
  );
  return rows.map((row) => row.actor_member_id);
}

async function activityKinds(): Promise<string[]> {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ kind: string }>(
    "select kind from activities where workspace_id = $1 order by at asc",
    [workspaceId],
  );
  return rows.map((row) => row.kind);
}

async function tourFinishedAt(memberId: string): Promise<Date | null> {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ tour_finished_at: Date | null }>(
    "select tour_finished_at from workspace_members where id = $1",
    [memberId],
  );
  return rows[0]?.tour_finished_at ?? null;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $1, $2), ($3, $3, $4)",
    [FOUNDER, "l08-founder@example.com", JOINER, "l08-joiner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: FOUNDER,
    name: "Founder",
  });
  workspaceId = provisioned.workspaceId;
  founderMemberId = provisioned.memberId;
  // Joined through an invitation, the way every second member arrives, so the
  // member holds `edit` and not the founder's `full`.
  joinerMemberId = (
    await withWorkspace(drizzle(wb.appPool), workspaceId, (tx) =>
      provisionMemberForInvite(tx, {
        workspaceId,
        user: { id: JOINER, name: "Joiner" },
      }),
    )
  ).memberId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("workspace.reopenOnboarding", () => {
  it("offers the setup again and keeps every answer already given", async () => {
    await callAction(await as(FOUNDER), "settings.updateWorkspaceGeneral", {
      timezone: "Asia/Kuala_Lumpur",
    });
    await callAction(await as(FOUNDER), "rhythm.update", {
      defaultCheckInFrequency: "monthly",
    });
    await callAction(await as(FOUNDER), "workspace.finishOnboarding", {});
    const before = await storedSettings();
    expect(before.onboardingDone).toBe(true);

    const result = await callAction(
      await as(FOUNDER),
      "workspace.reopenOnboarding",
      {},
    );
    expect(result).toEqual({ workspaceId, onboardingDone: false });

    // The one flag moved, and nothing else in the map did. A whole-object
    // write would have reset the timezone the owner chose.
    const after = await storedSettings();
    expect(after).toEqual({ ...before, onboardingDone: false });
    expect(after.timezone).toBe("Asia/Kuala_Lumpur");

    // The rhythm lives in its own table and is not touched at all.
    const rhythm = await callAction(await as(FOUNDER), "rhythm.read", {});
    expect(rhythm.defaultCheckInFrequency).toBe("monthly");

    // And members may read that setup is pending again, which is what the
    // Work Map's redirect reads.
    const read = await callAction(
      await as(FOUNDER),
      "settings.readForMember",
      {},
    );
    expect(read.settings.onboardingDone).toBe(false);
  });

  it("is audited with the administrator who pressed it, and shows in the feed", async () => {
    await callAction(await as(FOUNDER), "workspace.finishOnboarding", {});
    await callAction(await as(FOUNDER), "workspace.reopenOnboarding", {});

    expect(await auditActions("workspace.reopen_onboarding")).toEqual([
      founderMemberId,
    ]);
    expect(await activityKinds()).toContain("workspace.onboarding_reopened");
    // Workspace news, like its finish: it decides what every administrator
    // meets on the Work Map.
    expect(PRIVATE_ACTIVITY_KINDS.has("workspace.onboarding_reopened")).toBe(
      false,
    );
  });

  it("is an administrator's, and a member who holds edit is refused", async () => {
    await callAction(await as(FOUNDER), "workspace.finishOnboarding", {});

    await expect(
      callAction(await as(JOINER), "workspace.reopenOnboarding", {}),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect((await storedSettings()).onboardingDone).toBe(true);
    expect(await auditActions("workspace.reopen_onboarding")).toEqual([]);
  });

  it("finishing again closes it, so the pair can go round more than once", async () => {
    await callAction(await as(FOUNDER), "workspace.finishOnboarding", {});
    await callAction(await as(FOUNDER), "workspace.reopenOnboarding", {});
    await callAction(await as(FOUNDER), "workspace.finishOnboarding", {});
    expect((await storedSettings()).onboardingDone).toBe(true);
  });
});

describe("the first-visit tour", () => {
  it("is offered to every member who has not finished it", async () => {
    // Nothing writes the column when a member arrives: null is the offer.
    expect(
      await callAction(await as(FOUNDER), "people.readOwnTour", {}),
    ).toEqual({ finished: false });
    expect(
      await callAction(await as(JOINER), "people.readOwnTour", {}),
    ).toEqual({ finished: false });
  });

  it("is finished per member, never for the workspace", async () => {
    // The joiner holds `edit` and nothing more, which is what every invited
    // colleague holds, so this also proves the write is theirs to make.
    const finished = await callAction(
      await as(JOINER),
      "people.finishOwnTour",
      {},
    );
    expect(finished).toEqual({ finished: true });

    expect(await tourFinishedAt(joinerMemberId)).toBeInstanceOf(Date);
    expect(await tourFinishedAt(founderMemberId)).toBeNull();
    expect(
      await callAction(await as(JOINER), "people.readOwnTour", {}),
    ).toEqual({ finished: true });
    expect(
      await callAction(await as(FOUNDER), "people.readOwnTour", {}),
    ).toEqual({ finished: false });
  });

  it("keeps the first moment when it is finished twice", async () => {
    await callAction(await as(JOINER), "people.finishOwnTour", {});
    const first = await tourFinishedAt(joinerMemberId);
    await callAction(await as(JOINER), "people.finishOwnTour", {});
    expect(await tourFinishedAt(joinerMemberId)).toEqual(first);
  });

  it("is audited, and kept out of the workspace's feed", async () => {
    await callAction(await as(JOINER), "people.finishOwnTour", {});

    expect(await auditActions("people.finishOwnTour")).toEqual([
      joinerMemberId,
    ]);
    expect(await activityKinds()).toContain("member.tour_finished");
    // One person closing a tour is nobody else's news.
    expect(PRIVATE_ACTIVITY_KINDS.has("member.tour_finished")).toBe(true);
  });

  it("answers not found for somebody who is not a member", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "insert into users (id, name, email) values ($1, $1, $2)",
      ["l08-stranger", "l08-stranger@example.com"],
    );
    await expect(
      callAction(await as("l08-stranger"), "people.readOwnTour", {}),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
