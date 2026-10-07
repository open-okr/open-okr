import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Booking a whole cycle's rhythm, and phase 6 reading it (METHOD.md §7.1,
 * §2.3; completeness review H-08).
 *
 * Nothing in the browser could create a session, so after onboarding's one
 * weekly session nobody could hold a check-in, a monthly review or a quarterly
 * review, and phase 6 could never be answered. Q1 2030 is used because it is
 * in the future whenever this runs, so nothing is skipped as past: it starts
 * on a Tuesday, ends on a Sunday, and holds thirteen Monday-to-Sunday weeks.
 */

const OWNER = "booking-owner";
const SECOND = "booking-second";
const ZONE = "Asia/Kuala_Lumpur";

let workspaceId: string;
let spaceId: string;
let spaceName: string;
let ownerMemberId: string;
let secondMemberId: string;
let cycleId: string;
let goalId: string;

const context = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

const call = async (
  name: Parameters<typeof callAction>[1],
  input: unknown,
): Promise<unknown> => {
  const wb = await workerDb();
  // The registry types each input by its action's literal name, and these
  // tests call several through one helper.
  return callAction({ pool: wb.appPool, ...context() }, name, input as never);
};

const booked = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    kind: string;
    title: string;
    on: string;
    at: string;
    cycle_id: string | null;
  }>(
    `select kind, title, cycle_id,
            to_char(scheduled_for at time zone $2, 'YYYY-MM-DD') as on,
            to_char(scheduled_for at time zone $2, 'HH24:MI') as at
       from okr_sessions
      where workspace_id = $1 and deleted_at is null
      order by scheduled_for, kind`,
    [workspaceId, ZONE],
  );
  return rows;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $1, $2), ($3, $3, $4)",
    [OWNER, "booking-owner@example.com", SECOND, "booking-second@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Booking Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
  await wb.admin.query(
    `update workspaces set settings = settings || jsonb_build_object('timezone', $2::text)
      where id = $1`,
    [workspaceId, ZONE],
  );
  const second = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Booking Second', 'active') returning id`,
    [workspaceId, SECOND],
  );
  secondMemberId = second.rows[0]?.id as string;

  const spaces = (await call("spaces.list", {})) as Array<{
    id: string;
    name: string;
  }>;
  spaceId = spaces[0]?.id as string;
  spaceName = spaces[0]?.name as string;
  cycleId = (
    (await call("cycles.create", { on: "2030-02-15" })) as {
      id: string;
    }
  ).id;
  goalId = (
    (await call("goals.create", {
      title: "Make onboarding the reason new customers stay",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: secondMemberId,
      weight: 1,
    })) as { id: string }
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

const phaseSix = async () => {
  const read = (await call("workflow.read", { cycleId })) as {
    phases: Array<{ phase: number; state: string; missing: string[] }>;
  };
  return read.phases.find((phase) => phase.phase === 6);
};

describe("booking the whole cycle", () => {
  it("books thirteen check-ins, two monthly reviews and the quarterly review, at the local hour", async () => {
    const result = (await call("sessions.bookCycle", {
      spaceId,
      cycleId,
      weekday: 1,
      time: "09:30",
      facilitatorId: ownerMemberId,
    })) as { booked: number; missing: string[]; cycleId: string };

    expect(result).toMatchObject({ booked: 16, missing: [], cycleId });
    const rows = await booked();
    const of = (kind: string) => rows.filter((row) => row.kind === kind);
    expect(of("weekly")).toHaveLength(13);
    expect(of("monthly").map((row) => row.on)).toEqual([
      "2030-01-28",
      "2030-02-25",
    ]);
    // About two weeks before 31 March (§8, P9-T20a): the Monday of the week
    // around the 17th.
    expect(of("quarterly").map((row) => row.on)).toEqual(["2030-03-18"]);
    // The first week has no Monday inside the cycle, so its Tuesday.
    expect(of("weekly")[0]?.on).toBe("2030-01-01");
    // 09:30 where the workspace is, not 09:30 UTC.
    expect(new Set(rows.map((row) => row.at))).toEqual(new Set(["09:30"]));
    expect(new Set(rows.map((row) => row.cycle_id))).toEqual(
      new Set([cycleId]),
    );
    expect(of("weekly")[0]?.title).toBe("Weekly check-in");
    expect(of("quarterly")[0]?.title).toBe("Quarterly review");
  });

  it("books nothing the second time", async () => {
    const input = {
      spaceId,
      cycleId,
      weekday: 3,
      time: "14:00",
      facilitatorId: ownerMemberId,
    };
    await call("sessions.bookCycle", input);
    const again = (await call("sessions.bookCycle", input)) as {
      booked: number;
    };
    expect(again.booked).toBe(0);
    expect(await booked()).toHaveLength(16);
  });

  it("leaves a session somebody booked by hand where it is", async () => {
    await call("sessions.create", {
      spaceId,
      cycleId,
      kind: "weekly",
      title: "Our own check-in",
      scheduledFor: "2030-01-09T16:00",
      facilitatorId: secondMemberId,
    });
    const result = (await call("sessions.bookCycle", {
      spaceId,
      cycleId,
      weekday: 1,
      time: "09:30",
      facilitatorId: ownerMemberId,
    })) as { booked: number };
    expect(result.booked).toBe(15);
    const week = (await booked()).filter(
      (row) => row.on >= "2030-01-07" && row.on <= "2030-01-13",
    );
    expect(week).toEqual([
      expect.objectContaining({ title: "Our own check-in", at: "16:00" }),
    ]);
  });

  it("refuses a facilitator who is not an active member here", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [secondMemberId],
    );
    await expect(
      call("sessions.bookCycle", {
        spaceId,
        cycleId,
        weekday: 1,
        time: "09:30",
        facilitatorId: secondMemberId,
      }),
    ).rejects.toThrow(/active member/);
  });

  it("refuses a closed cycle", async () => {
    const wb = await workerDb();
    await wb.admin.query("update cycles set status = 'closed' where id = $1", [
      cycleId,
    ]);
    await expect(
      call("sessions.bookCycle", {
        spaceId,
        cycleId,
        weekday: 1,
        time: "09:30",
        facilitatorId: ownerMemberId,
      }),
    ).rejects.toThrow(/closed/);
  });
});

describe("scheduling one session", () => {
  it("reads a time with no offset in the workspace timezone", async () => {
    await call("sessions.create", {
      spaceId,
      kind: "monthly",
      title: "January review",
      scheduledFor: "2030-01-29T10:00",
      facilitatorId: ownerMemberId,
    });
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ utc: string }>(
      `select to_char(scheduled_for at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as utc
         from okr_sessions where workspace_id = $1`,
      [workspaceId],
    );
    expect(rows[0]?.utc).toBe("2030-01-29 02:00");
  });

  it("refuses a time that is not a date and time", async () => {
    await expect(
      call("sessions.create", {
        spaceId,
        kind: "weekly",
        title: "Whenever",
        scheduledFor: "next Tuesday",
        facilitatorId: ownerMemberId,
      }),
    ).rejects.toThrow();
  });
});

describe("phase 6 reads the booking", () => {
  it("names the space and every ritual that is short before anything is booked", async () => {
    const six = await phaseSix();
    expect(six?.state).toBe("todo");
    expect(six?.missing[0]).toMatch(
      new RegExp(
        `^The cadence is not booked for the whole cycle\\. ${spaceName}: No weekly check-in is booked in 13 week\\(s\\)`,
      ),
    );
    expect(six?.missing[0]).toContain("No quarterly review is booked");
    expect(six?.missing[1]).toBe("No decision has been recorded");
  });

  it("is left needing only a decision once the cycle is booked", async () => {
    await call("sessions.bookCycle", {
      spaceId,
      cycleId,
      weekday: 2,
      time: "10:00",
      facilitatorId: ownerMemberId,
    });
    const six = await phaseSix();
    expect(six?.missing).toEqual(["No decision has been recorded"]);
  });
});

/**
 * Phase 7 reads the scores and the retro (completeness review H-09). Neither
 * input was ever supplied, so the last phase of every cycle stayed blocked.
 */
describe("phase 7 reads the scores and the retro", () => {
  const phaseSeven = async () => {
    const read = (await call("workflow.read", { cycleId })) as {
      phases: Array<{
        phase: number;
        state: string;
        missing: string[];
        blocked: string[];
      }>;
    };
    return read.phases.find((phase) => phase.phase === 7);
  };

  it("names both conditions until the key results are scored and the retro is held", async () => {
    const keyResult = (await call("goals.addKeyResult", {
      goalId,
      title: "Raise activation from 41% to 60%",
      direction: "increase",
      indicatorType: "leading",
      baselineValue: 41,
      targetValue: 60,
      weight: 1,
    })) as { id: string };

    const before = await phaseSeven();
    expect(before?.blocked).toEqual([]);
    expect(before?.missing).toEqual([
      "Not every key result is scored",
      "The retrospective is not written",
    ]);

    // The quarterly review writes a score back when it closes; the close is
    // covered by the review suites, and this reads the column it writes.
    const wb = await workerDb();
    await wb.admin.query("update key_results set score = 0.7 where id = $1", [
      keyResult.id,
    ]);
    const review = (await call("sessions.create", {
      spaceId,
      cycleId,
      kind: "quarterly",
      title: "Quarterly review",
      scheduledFor: "2030-03-28T10:00",
      facilitatorId: ownerMemberId,
    })) as { id: string };
    await call("sessions.addRetroNote", {
      sessionId: review.id,
      columnKey: "worked",
      text: "Booking the whole quarter up front kept the rhythm",
    });

    const after = await phaseSeven();
    expect(after?.state).toBe("pass");
    expect(after?.missing).toEqual([]);
  });

  it("does not call a cycle with no key results scored", async () => {
    expect((await phaseSeven())?.missing).toContain(
      "Not every key result is scored",
    );
  });
});
