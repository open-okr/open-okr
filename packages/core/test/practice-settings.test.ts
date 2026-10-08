import { defaultPractice, PRACTICE_KEYS } from "@openokr/method";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { bindGroup, ensureMemberGroup } from "../src/access/contexts.ts";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { resolveSubjectContext } from "../src/access/reads.ts";
import { callAction } from "../src/actions/registry.ts";
import { runOperation } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Practice settings actions (P9-T01, METHOD.md §12).
 *
 * A fresh workspace reads the recommended profile with every default and
 * nothing stored. An admin's change is stored sparse, audited, and resettable
 * one key at a time. A profile switch keeps the workspace's own changes. A
 * member with `edit` reads the practice and cannot change it. And nothing a
 * screen could send that is not a §12 setting, or not one of its options, is
 * stored.
 */

const OWNER = "practice-owner";

let workspaceId: string;

const context = (actorUserId: string) => ({
  workspaceId,
  actor: { kind: "human" as const, userId: actorUserId },
});

async function call<T>(
  userId: string,
  action: string,
  input: unknown,
): Promise<T> {
  return (await callAction(
    { pool: (await workerDb()).appPool, ...context(userId) },
    action as never,
    input as never,
  )) as T;
}

/** A colleague with `edit` on the workspace and nothing more, as an invited member holds. */
async function addEditor(userId: string): Promise<void> {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [userId, "Editor", `${userId}@example.com`],
  );
  const inserted = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, kind, status)
     values (gen_random_uuid(), $1, $2, 'Editor', 'human', 'active')
     returning id`,
    [workspaceId, userId],
  );
  const memberId = inserted.rows[0]?.id as string;
  await runOperation(
    { pool: wb.appPool },
    {
      action: "test.grant-edit",
      workspaceId,
      actor: { kind: "human", userId: OWNER },
      async execute({ tx }) {
        const subject = await resolveSubjectContext(
          tx,
          "workspace",
          workspaceId,
          workspaceId,
        );
        const groupId = await ensureMemberGroup(tx, { workspaceId, memberId });
        await bindGroup(tx, {
          workspaceId,
          groupId,
          contextId: (subject as { contextId: string }).contextId,
          level: ACCESS_LEVELS.edit,
        });
        return {
          result: undefined,
          activity: {
            kind: "test.grant-edit",
            subjectType: "workspace_member",
            subjectId: memberId,
          },
          audit: { action: "test.grant-edit", targetType: "workspace_member" },
        };
      },
    },
  );
}

async function storedRow(): Promise<{ profile: string; practice: unknown }> {
  const wb = await workerDb();
  const rows = await wb.admin.query<{ profile: string; practice: unknown }>(
    "select profile, practice from rhythm_settings where workspace_id = $1",
    [workspaceId],
  );
  return rows.rows[0] as { profile: string; practice: unknown };
}

async function auditActions(): Promise<{ action: string; payload: unknown }[]> {
  const wb = await workerDb();
  const rows = await wb.admin.query<{ action: string; payload: unknown }>(
    `select action, payload from audit_events
      where workspace_id = $1 and action like 'practice.%'
      order by at asc`,
    [workspaceId],
  );
  return rows.rows;
}

interface PracticeState {
  profile: string;
  overrides: Record<string, string>;
  practice: Record<string, string>;
  differsFromProfile: string[];
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Practice Owner", "practice-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Practice Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("practice.read", () => {
  it("returns the recommended profile with every default and no stored changes on a fresh workspace", async () => {
    const read = await call<
      PracticeState & {
        registry: { key: string }[];
        profiles: { key: string }[];
      }
    >(OWNER, "practice.read", {});

    expect(read.profile).toBe("recommended");
    expect(read.overrides).toEqual({});
    expect(read.practice).toEqual(defaultPractice());
    expect(read.differsFromProfile).toEqual([]);
    expect(read.registry.map((entry) => entry.key)).toEqual(PRACTICE_KEYS);
    expect(read.profiles.map((profile) => profile.key)).toEqual([
      "recommended",
      "googleStyle",
      "radicalFocus",
      "lightweight",
      "governed",
    ]);

    // Provisioning wrote the row with its database defaults, which are the
    // recommended profile and nothing changed.
    expect(await storedRow()).toEqual({ profile: "recommended", practice: {} });
  });

  it("serves a member who holds edit, because everybody may read the rules they write under", async () => {
    await addEditor("practice-editor");
    const read = await call<PracticeState>(
      "practice-editor",
      "practice.read",
      {},
    );
    expect(read.practice["writing.when"]).toBe("anytime");
  });
});

describe("practice.update", () => {
  it("stores only the change, audits it, and resolves it", async () => {
    const updated = await call<PracticeState>(OWNER, "practice.update", {
      overrides: { reviewer: "required", "review.format": "split" },
    });

    expect(updated.overrides).toEqual({
      reviewer: "required",
      "review.format": "split",
    });
    expect(updated.practice.reviewer).toBe("required");
    expect(updated.differsFromProfile).toEqual(["reviewer", "review.format"]);
    expect((await storedRow()).practice).toEqual({
      reviewer: "required",
      "review.format": "split",
    });

    const audit = await auditActions();
    expect(audit.map((row) => row.action)).toEqual(["practice.update"]);
    expect(audit[0]?.payload).toMatchObject({
      set: { reviewer: "required", "review.format": "split" },
      reset: [],
    });
  });

  it("returns one setting to its profile's value with null, leaving the rest", async () => {
    await call(OWNER, "practice.update", {
      overrides: { reviewer: "required", "review.format": "split" },
    });
    const reset = await call<PracticeState>(OWNER, "practice.update", {
      overrides: { reviewer: null },
    });
    expect(reset.overrides).toEqual({ "review.format": "split" });
    expect(reset.practice.reviewer).toBe("optional");
  });

  it("returns a setting to a non-default profile's value, not the canon default", async () => {
    // Governed requires reviewers, where the canon default is optional. A
    // reset has to land back on Governed's required, and store nothing.
    await call(OWNER, "practice.applyProfile", { profile: "governed" });
    await call(OWNER, "practice.update", {
      overrides: { reviewer: "optional" },
    });
    const reset = await call<PracticeState>(OWNER, "practice.update", {
      overrides: { reviewer: null },
    });
    expect(reset.overrides).toEqual({});
    expect(reset.practice.reviewer).toBe("required");
  });

  it("does not store a value equal to the profile's own", async () => {
    // A settings card submits every field it renders. Storing the unchanged
    // ones would freeze them against a later change to the default.
    const updated = await call<PracticeState>(OWNER, "practice.update", {
      overrides: { reviewer: "optional", "writing.when": "anytime" },
    });
    expect(updated.overrides).toEqual({});
    expect((await storedRow()).practice).toEqual({});
  });

  it("refuses an unknown setting or option with every reason at once, and stores nothing", async () => {
    await expect(
      call(OWNER, "practice.update", {
        overrides: { "writing.when": "whenever", "not.a.setting": "on" },
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      call(OWNER, "practice.update", { overrides: { "not.a.setting": null } }),
    ).rejects.toThrow(/not a practice setting/);
    expect((await storedRow()).practice).toEqual({});
    expect(await auditActions()).toEqual([]);
  });

  it("refuses a member who holds edit but not full access", async () => {
    await addEditor("practice-editor");
    await expect(
      call("practice-editor", "practice.update", {
        overrides: { reviewer: "off" },
      }),
    ).rejects.toBeTruthy();
    expect((await storedRow()).practice).toEqual({});
  });
});

describe("practice.applyProfile", () => {
  it("switches the profile, keeps the workspace's own changes, and audits which still override it", async () => {
    await call(OWNER, "practice.update", { overrides: { reviewer: "off" } });

    const governed = await call<PracticeState>(OWNER, "practice.applyProfile", {
      profile: "governed",
    });
    expect(governed.profile).toBe("governed");
    expect(governed.practice["phases.enforcement"]).toBe("binding");
    // Governed requires a reviewer; this workspace turned reviewers off, and
    // that choice survives the switch and is named as differing.
    expect(governed.practice.reviewer).toBe("off");
    expect(governed.differsFromProfile).toEqual(["reviewer"]);

    const back = await call<PracticeState>(OWNER, "practice.applyProfile", {
      profile: "recommended",
    });
    expect(back.practice["phases.enforcement"]).toBe("guided");
    expect(back.practice.reviewer).toBe("off");

    const audit = await auditActions();
    expect(audit.map((row) => row.action)).toEqual([
      "practice.update",
      "practice.apply_profile",
      "practice.apply_profile",
    ]);
    expect(audit[1]?.payload).toMatchObject({
      from: "recommended",
      to: "governed",
      keptChanges: ["reviewer"],
    });
  });

  it("refuses a profile §12.2 does not define", async () => {
    await expect(
      call(OWNER, "practice.applyProfile", { profile: "bespoke" }),
    ).rejects.toBeTruthy();
    expect((await storedRow()).profile).toBe("recommended");
  });
});

describe("practice.applyProfile writes the thresholds a profile sets (P9-T05)", () => {
  async function thresholdsRow(): Promise<{
    frequency: string;
    overrides: Record<string, unknown>;
  }> {
    const wb = await workerDb();
    const rows = await wb.admin.query<{
      frequency: string;
      overrides: Record<string, unknown>;
    }>(
      `select default_check_in_frequency as frequency, overrides
         from rhythm_settings where workspace_id = $1`,
      [workspaceId],
    );
    return rows.rows[0] as {
      frequency: string;
      overrides: Record<string, unknown>;
    };
  }

  it("sets Lightweight's check-in frequency in its own column, and puts it back on leaving", async () => {
    const applied = await call<{ thresholdsChanged: string[] }>(
      OWNER,
      "practice.applyProfile",
      { profile: "lightweight" },
    );
    expect(applied.thresholdsChanged).toEqual(["cadence.checkInFrequency"]);
    expect((await thresholdsRow()).frequency).toBe("biweekly");

    await call(OWNER, "practice.applyProfile", { profile: "recommended" });
    expect((await thresholdsRow()).frequency).toBe("weekly");
  });

  it("stores Radical Focus's caps as overrides, and removes them rather than storing the canon on leaving", async () => {
    await call(OWNER, "practice.applyProfile", { profile: "radicalFocus" });
    expect((await thresholdsRow()).overrides).toMatchObject({
      "quality.objectivesPerUnitCap": 1,
      "quality.keyResultsPerObjective": { low: 2, high: 3 },
    });
    const rhythm = await call<{ thresholds: Record<string, unknown> }>(
      OWNER,
      "rhythm.read",
      {},
    );
    expect(rhythm.thresholds["quality.objectivesPerUnitCap"]).toBe(1);

    await call(OWNER, "practice.applyProfile", { profile: "recommended" });
    const after = (await thresholdsRow()).overrides;
    expect(after).not.toHaveProperty("quality.objectivesPerUnitCap");
    expect(after).not.toHaveProperty("quality.keyResultsPerObjective");
  });

  it("keeps a threshold the workspace set itself, and audits what it wrote and kept", async () => {
    await call(OWNER, "rhythm.update", { defaultCheckInFrequency: "monthly" });
    const applied = await call<{
      thresholdsChanged: string[];
      thresholdsKept: string[];
    }>(OWNER, "practice.applyProfile", { profile: "lightweight" });
    expect(applied.thresholdsChanged).toEqual([]);
    expect(applied.thresholdsKept).toEqual(["cadence.checkInFrequency"]);
    expect((await thresholdsRow()).frequency).toBe("monthly");

    const audit = await auditActions();
    expect(audit.at(-1)?.payload).toMatchObject({
      to: "lightweight",
      thresholds: [],
      keptThresholds: ["cadence.checkInFrequency"],
    });
  });

  it("names each option in METHOD.md §12.1's words", async () => {
    const read = await call<{
      registry: { key: string; optionLabels: Record<string, string> }[];
    }>(OWNER, "practice.read", {});
    const writing = read.registry.find((entry) => entry.key === "writing.when");
    expect(writing?.optionLabels).toEqual({
      anytime: "Any time",
      planningWindow: "Planning window",
      afterPhases: "After the phases",
    });
  });
});
