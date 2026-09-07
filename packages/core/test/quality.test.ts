import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Server-side quality evaluation against a real database (P4-T02a).
 *
 * The task's test plan, one test each: the flags stored on the goal match the
 * last evaluation exactly, strict mode changes the stored score for the same
 * input, and the evaluation adds no extra transaction.
 *
 * The point of driving these through `callAction` rather than calling the
 * service is that the score has to be written by the *same* Operation as the
 * goal. A test that called the recompute itself would pass while the product
 * shipped a second transaction, which is the thing worth proving.
 */

const OWNER = "quality-owner";
const SECOND = "quality-second";

let workspaceId: string;
let cycleId: string;
let ownerMemberId: string;
let secondMemberId: string;

const context = () => ({
  workspaceId,
  actor: { kind: "human" as const, userId: OWNER },
});

const createGoal = async (overrides: Record<string, unknown> = {}) => {
  const wb = await workerDb();
  return callAction({ pool: wb.appPool, ...context() }, "goals.create", {
    title: "Become the preferred platform for mid-market teams",
    cycleId,
    level: "company",
    championId: ownerMemberId,
    reviewerId: secondMemberId,
    ...overrides,
  } as never);
};

const addKeyResult = async (
  goalId: string,
  overrides: Record<string, unknown> = {},
) => {
  const wb = await workerDb();
  return callAction({ pool: wb.appPool, ...context() }, "goals.addKeyResult", {
    goalId,
    title: "Increase NPS from 32 to 50",
    direction: "increase",
    indicatorType: "lagging",
    baselineValue: 32,
    targetValue: 50,
    weight: 1,
    ...overrides,
  } as never);
};

/** The stored answer, read straight from the columns. */
const storedGoal = async (goalId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    quality_score: number | null;
    quality_flags: string[];
  }>("select quality_score, quality_flags from goals where id = $1", [goalId]);
  return rows[0];
};

const storedKeyResultFlags = async (keyResultId: string) => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{ quality_flags: string[] }>(
    "select quality_flags from key_results where id = $1",
    [keyResultId],
  );
  return rows[0]?.quality_flags ?? [];
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Quality Owner",
      "quality-owner@example.com",
      SECOND,
      "Quality Second",
      "quality-second@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Quality Owner",
  });
  workspaceId = provisioned.workspaceId;

  const current = await callAction(
    { pool: wb.appPool, ...context() },
    "cycles.current",
    { mode: "quarterly" },
  );
  cycleId = current?.id as string;

  const members = await wb.admin.query<{ id: string; user_id: string | null }>(
    "select id, user_id from workspace_members where workspace_id = $1",
    [workspaceId],
  );
  ownerMemberId = members.rows.find((row) => row.user_id === OWNER)
    ?.id as string;
  const second = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Quality Second', 'active') returning id`,
    [workspaceId, SECOND],
  );
  secondMemberId = second.rows[0]?.id as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the flags stored on a goal", () => {
  it("are written by the same Operation that created it", async () => {
    const created = (await createGoal()) as { id: string };
    const stored = await storedGoal(created.id);
    // A strong objective with no key results yet: the objective checks pass and
    // KR-1 fails because there are none.
    //
    // The title has to carry a §4.1 state word to pass OBJ-1. METHOD.md §4.6's
    // own strong example, "Make mobile the way our customers prefer to reach
    // us", warns with "Cannot tell" instead: it names a change in state that no
    // word list can see. That is the deterministic path being honest rather than
    // wrong, and it is the gap §4 expects AI to close. Recorded on the STATUS
    // row as a question for a human.
    expect(stored?.quality_score).not.toBeNull();
    expect(stored?.quality_flags).toContain("KR-1");
    expect(stored?.quality_flags).not.toContain("OBJ-1");
  });

  it("carry OBJ-1's failure the moment the title becomes output-shaped", async () => {
    const created = (await createGoal()) as { id: string };
    const before = await storedGoal(created.id);
    expect(before?.quality_flags).not.toContain("OBJ-1");

    const wb = await workerDb();
    await callAction({ pool: wb.appPool, ...context() }, "goals.update", {
      id: created.id,
      title: "Launch the new mobile app",
    } as never);

    const after = await storedGoal(created.id);
    expect(after?.quality_flags).toContain("OBJ-1");
    // The acceptance criterion: the score drops as well as the flag appearing.
    expect(after?.quality_score as number).toBeLessThan(
      before?.quality_score as number,
    );
  });

  it("rescore the whole set when a key result is added", async () => {
    const created = (await createGoal()) as { id: string };
    expect((await storedGoal(created.id))?.quality_flags).toContain("KR-1");

    const kr = (await addKeyResult(created.id)) as { id: string };
    const after = await storedGoal(created.id);
    // One key result is a warn on KR-1, not a fail, and the set is now all
    // lagging so KR-4 warns too.
    expect(after?.quality_flags).toContain("KR-1");
    expect(after?.quality_flags).toContain("KR-4");
    expect(await storedKeyResultFlags(kr.id)).not.toContain("KR-2");
  });

  it("name which key result tripped a check, not just that one did", async () => {
    const created = (await createGoal()) as { id: string };
    const measured = (await addKeyResult(created.id)) as { id: string };
    const vague = (await addKeyResult(created.id, {
      title: "Improve customer satisfaction",
      indicatorType: "leading",
    })) as { id: string };

    // KR-2 reads the text, and only one of these two carries its numbers.
    expect(await storedKeyResultFlags(vague.id)).toContain("KR-2");
    expect(await storedKeyResultFlags(measured.id)).not.toContain("KR-2");
  });
});

describe("per-workspace strictness", () => {
  it("changes the stored score for the same input", async () => {
    const wb = await workerDb();
    // Three words: OBJ-1 passes on "trusted" and OBJ-2 warns on the length.
    // A title that *failed* would be no test at all, because strict mode
    // promotes warns and leaves fails alone.
    const warned = (await createGoal({
      title: "Become genuinely trusted",
    })) as { id: string };
    const atWarn = await storedGoal(warned.id);

    await wb.admin.query(
      "update rhythm_settings set coach_strictness = 'strict' where workspace_id = $1",
      [workspaceId],
    );

    // Any write rescores, so the same text is judged again under the new
    // setting. Strictness is applied server-side, so this is the stored answer
    // and not a rendering choice.
    await callAction({ pool: wb.appPool, ...context() }, "goals.update", {
      id: warned.id,
      title: "Become genuinely trusted",
    } as never);
    const atStrict = await storedGoal(warned.id);

    expect(atStrict?.quality_score as number).toBeLessThan(
      atWarn?.quality_score as number,
    );
    // The flags are the same set either way: strictness moves the consequence,
    // never the problem. §4 says every warn becomes a fail, not that new checks
    // start firing.
    expect(atStrict?.quality_flags).toEqual(atWarn?.quality_flags);
  });
});

describe("OBJ-5, which is a property of the set", () => {
  it("rescores the siblings when a fourth objective joins the unit", async () => {
    const first = (await createGoal({ level: "team" })) as { id: string };
    await createGoal({ level: "team" });
    await createGoal({ level: "team" });
    expect((await storedGoal(first.id))?.quality_flags).not.toContain("OBJ-5");

    // The fourth breaks the per-unit cap, and the verdict belongs to all four
    // rather than to the one that happened to arrive last.
    await createGoal({ level: "team" });
    expect((await storedGoal(first.id))?.quality_flags).toContain("OBJ-5");
  });

  it("clears the flag again when one is closed", async () => {
    const wb = await workerDb();
    const first = (await createGoal({ level: "team" })) as { id: string };
    await createGoal({ level: "team" });
    await createGoal({ level: "team" });
    const fourth = (await createGoal({ level: "team" })) as { id: string };
    expect((await storedGoal(first.id))?.quality_flags).toContain("OBJ-5");

    await callAction({ pool: wb.appPool, ...context() }, "goals.close", {
      id: fourth.id,
      successStatus: "achieved",
      closeDecision: "keep",
      closeReason: "Done.",
      retrospectiveBody: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "It worked." }],
          },
        ],
      },
    } as never);

    // OBJ-5 counts the open objectives, so closing one takes the unit back
    // under the cap for the three still running.
    expect((await storedGoal(first.id))?.quality_flags).not.toContain("OBJ-5");
  });
});

describe("what the evaluation costs", () => {
  it("adds no transaction: the score is in the row the moment the action returns", async () => {
    // If the score were written by a second transaction, there would be a
    // window where the goal exists and its score does not. Reading immediately
    // after the action returns is the narrowest test of that available.
    const created = (await createGoal()) as { id: string };
    const stored = await storedGoal(created.id);
    expect(stored?.quality_score).not.toBeNull();
    expect(Array.isArray(stored?.quality_flags)).toBe(true);
  });

  it("leaves a workspace with no rhythm row on the canon defaults", async () => {
    const wb = await workerDb();
    // Nothing must have to be configured before the product works, so a
    // missing settings row resolves to §11's own defaults rather than refusing.
    await wb.admin.query(
      "delete from rhythm_settings where workspace_id = $1",
      [workspaceId],
    );
    const created = (await createGoal()) as { id: string };
    expect((await storedGoal(created.id))?.quality_score).not.toBeNull();
  });
});

/**
 * What the quality panel counts (P4-T02c).
 *
 * The panel re-evaluates in the browser rather than reading the stored flags,
 * so the number it shows has to be the number the server stored. These assert
 * the two agree, which is the only thing that makes re-evaluating safe.
 */
describe("the panel and the stored flags", () => {
  it("count the same issues for the same set", async () => {
    const created = (await createGoal({
      title: "Launch the new mobile app",
    })) as { id: string };
    await addKeyResult(created.id);
    await addKeyResult(created.id, {
      title: "Improve customer satisfaction",
      indicatorType: "leading",
    });

    const stored = await storedGoal(created.id);
    const { applyStrictness, evaluateKeyResults, evaluateObjective } =
      await import("@openokr/method");
    const { canonThresholds } = await import("@openokr/method");
    const thresholds = canonThresholds();

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{
      title: string;
      baseline_value: string;
      target_value: string;
      due_on: string | null;
      owner_id: string | null;
      indicator_type: "leading" | "lagging";
      direction: "increase" | "reduce" | "maintain" | "move";
      confidence: string | null;
    }>(
      `select title, baseline_value, target_value, due_on, owner_id,
              indicator_type, direction, confidence
       from key_results where goal_id = $1 and deleted_at is null
       order by position`,
      [created.id],
    );

    const objective = applyStrictness(
      evaluateObjective(
        {
          title: "Launch the new mobile app",
          hasCycle: true,
          hasTimeframe: false,
          championId: ownerMemberId,
          reviewerId: secondMemberId,
          objectivesInUnit: 1,
          level: "company",
        },
        thresholds,
      ),
      "warn",
    );
    const keyResults = applyStrictness(
      evaluateKeyResults(
        {
          keyResults: rows.map((row) => ({
            text: row.title,
            baseline: Number(row.baseline_value),
            target: Number(row.target_value),
            dueOn: row.due_on,
            ownerId: row.owner_id,
            indicatorType: row.indicator_type,
            direction: row.direction,
            confidence: row.confidence === null ? null : Number(row.confidence),
          })),
        },
        thresholds,
      ),
      "warn",
    );

    const inBrowser = [...objective, ...keyResults]
      .filter((verdict) => verdict.status !== "pass")
      .map((verdict) => verdict.id)
      .sort();

    // Same package, same thresholds, same answer. If these ever diverge, one of
    // the two is reading something the other cannot see.
    expect(inBrowser).toEqual([...(stored?.quality_flags ?? [])].sort());
  });
});
