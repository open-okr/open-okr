/**
 * The rhythm assists (AI-NATIVE-PLAN.md §2.2, P4-T15b-a).
 *
 * The task's test plan:
 * - the deterministic digest template is what appears with the provider off
 * - a narrated trend never states a number the chart does not hold
 *
 * The second line is the interesting one, and it is enforced rather than hoped
 * for. Every narration is checked against the numbers the product itself
 * computed, and one figure that is not among them drops the whole narration. So
 * the tests that matter are the ones where a model states a plausible number
 * nobody measured and gets nothing published.
 *
 * `statesOnlyKnownNumbers` is tested directly as well as through both actions,
 * because it is the one function standing between a model and a false figure in
 * a digest that goes to leadership.
 */
import type { AgentDrafter } from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { statesOnlyKnownNumbers } from "../src/actions/rhythm-assists.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "rhythm-owner";

let workspaceId: string;
let spaceId: string;
let cycleId: string;
let ownerMemberId: string;
let sessionId: string;
let digestId: string;

const drafterWith = (parts: Partial<AgentDrafter>): AgentDrafter => ({
  spentUsd: () => 0,
  ...parts,
});

const contextFor = async (drafter?: AgentDrafter) => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId: OWNER },
    drafter,
  };
};

const call = async (name: string, input: unknown, drafter?: AgentDrafter) =>
  callAction(await contextFor(drafter), name as never, input as never);

/** Writes a digest row for the session, the way step 4 does. */
const writeDigest = async (
  body: Record<string, number>,
  options: {
    readonly weekStart?: string;
    readonly note?: string | null;
    readonly previous?: Record<string, number>;
    readonly previousWeekStart?: string;
  } = {},
) => {
  const wb = await workerDb();
  if (options.previous) {
    await wb.admin.query(
      `insert into digests (id, workspace_id, scope, scope_id, period, period_start, body, generated_at)
       values (gen_random_uuid(), $1, 'space', $2, 'weekly', $3, $4::jsonb, now())`,
      [
        workspaceId,
        spaceId,
        options.previousWeekStart ?? "2026-08-17",
        JSON.stringify(options.previous),
      ],
    );
  }
  const { rows } = await wb.admin.query<{ id: string }>(
    `insert into digests (id, workspace_id, scope, scope_id, period, period_start, body, note, generated_at)
     values (gen_random_uuid(), $1, 'space', $2, 'weekly', $3, $4::jsonb, $5, now())
     returning id`,
    [
      workspaceId,
      spaceId,
      options.weekStart ?? "2026-08-24",
      JSON.stringify(body),
      options.note ?? null,
    ],
  );
  digestId = rows[0]?.id as string;
  // `okr_sessions`, not `sessions`: Better Auth owns the `sessions` name, so
  // the OKR ritual's table is prefixed. Cost one confusing error message.
  await wb.admin.query("update okr_sessions set digest_id = $1 where id = $2", [
    digestId,
    sessionId,
  ]);
  return digestId;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Ada', $2)",
    [OWNER, "rhythm-owner@example.com"],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Ada",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  spaceId = ((await call("spaces.list", {})) as { id: string }[])[0]
    ?.id as string;
  cycleId = (
    (await call("cycles.current", { mode: "quarterly" })) as { id: string }
  ).id;

  const session = (await call("sessions.create", {
    spaceId,
    cycleId,
    kind: "weekly",
    title: "Week of 24 August",
    scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    facilitatorId: ownerMemberId,
  })) as { id: string };
  sessionId = session.id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the number check on its own", () => {
  it("accepts prose that only repeats what it was given", () => {
    expect(
      statesOnlyKnownNumbers("Confidence is 62%, up 7 points.", [62, 7]),
    ).toBe(true);
  });

  it("refuses a figure nobody measured", () => {
    // 41 is plausible, specific, and not in the set. That is exactly the failure
    // this check exists for.
    expect(
      statesOnlyKnownNumbers("Confidence is 62%, up from 41%.", [62, 7]),
    ).toBe(false);
  });

  it("accepts a number written with a decimal point it does not need", () => {
    // "62.0" is repeating 62, not inventing a figure, and a check that failed on
    // that would be one nothing could satisfy.
    expect(statesOnlyKnownNumbers("Confidence is 62.0%.", [62])).toBe(true);
  });

  it("accepts a comma as a decimal separator", () => {
    expect(statesOnlyKnownNumbers("Activation moved 1,5 points.", [1.5])).toBe(
      true,
    );
  });

  it("accepts prose with no numbers at all", () => {
    expect(statesOnlyKnownNumbers("Confidence held steady.", [])).toBe(true);
  });
});

describe("the deterministic digest", () => {
  it("is null before step 4 has produced one", () => {
    // A session that has not reached the digest stage has no digest, and saying
    // so is truer than rendering one full of zeroes.
    expect(call("sessions.digest", { sessionId })).resolves.toBeNull();
  });

  it("renders §7.2's six parts from the stored numbers", async () => {
    await writeDigest({
      averageConfidence: 0.62,
      onTrackCount: 3,
      atRiskCount: 0,
      blockerCount: 0,
      commitmentCount: 4,
    });

    const digest = (await call("sessions.digest", { sessionId })) as {
      weekStart: string;
      lines: string[];
      numbers: number[];
    };
    expect(digest.weekStart).toBe("2026-08-24");
    expect(digest.lines[0]).toContain("confidence 62%");
    expect(digest.lines).toContain("3 objectives on track.");
    expect(digest.lines).toContain("Nothing at risk.");
    expect(digest.lines).toContain("No blockers open.");
    expect(digest.lines).toContain("4 commitments for next week.");
    expect(digest.numbers).toEqual(expect.arrayContaining([62, 3, 4]));
  });

  it("computes the change on last week, which the stored row does not hold", async () => {
    await writeDigest(
      {
        averageConfidence: 0.62,
        onTrackCount: 3,
        atRiskCount: 0,
        blockerCount: 0,
        commitmentCount: 4,
      },
      { previous: { averageConfidence: 0.5 } },
    );

    const digest = (await call("sessions.digest", { sessionId })) as {
      lines: string[];
    };
    expect(digest.lines[0]).toContain("up 12 points on last week");
  });

  it("names what is at risk with its champion, which the stored row does not hold", async () => {
    const wb = await workerDb();
    const goal = (await call("goals.create", {
      title: "Raise mid-market activation",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    })) as { id: string };
    await wb.admin.query(
      "update goals set health = 'off_track' where id = $1",
      [goal.id],
    );

    await writeDigest({
      averageConfidence: 0.4,
      onTrackCount: 0,
      atRiskCount: 1,
      blockerCount: 0,
      commitmentCount: 1,
    });

    const digest = (await call("sessions.digest", { sessionId })) as {
      lines: string[];
    };
    expect(digest.lines[2]).toBe(
      "1 at risk: Raise mid-market activation (Ada, off track).",
    );
  });

  it("puts a blocker's age on the 24-hour clock", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `insert into blockers (id, workspace_id, type, owner_id, next_action, opened_at, due_at, session_id)
       values (gen_random_uuid(), $1, 'dependency', $2, 'Chase the billing team',
               now() - interval '30 hours', now() - interval '6 hours', $3)`,
      [workspaceId, ownerMemberId, sessionId],
    );
    await writeDigest({
      averageConfidence: 0.5,
      onTrackCount: 1,
      atRiskCount: 0,
      blockerCount: 1,
      commitmentCount: 2,
    });

    const digest = (await call("sessions.digest", { sessionId })) as {
      lines: string[];
      numbers: number[];
    };
    expect(digest.lines[3]).toContain("1 blocker open, 1 past the clock");
    expect(digest.lines[3]).toContain("Chase the billing team");
    expect(digest.lines[3]).toContain("past the 24-hour clock");
    expect(digest.numbers).toContain(30);
  });

  it("leaves out a resolved blocker", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `insert into blockers (id, workspace_id, type, owner_id, next_action, opened_at, due_at, resolved_at, session_id)
       values (gen_random_uuid(), $1, 'dependency', $2, 'Already done',
               now() - interval '30 hours', now() - interval '6 hours', now(), $3)`,
      [workspaceId, ownerMemberId, sessionId],
    );
    await writeDigest({
      averageConfidence: 0.5,
      onTrackCount: 1,
      atRiskCount: 0,
      blockerCount: 0,
      commitmentCount: 2,
    });
    const digest = (await call("sessions.digest", { sessionId })) as {
      lines: string[];
    };
    expect(digest.lines[3]).toBe("No blockers open.");
  });

  it("is refused for a suspended member", async () => {
    const wb = await workerDb();
    await writeDigest({ averageConfidence: 0.5, commitmentCount: 1 });
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [ownerMemberId],
    );
    await expect(call("sessions.digest", { sessionId })).rejects.toThrow();
  });
});

describe("narrating the digest", () => {
  const stored = () =>
    writeDigest({
      averageConfidence: 0.62,
      onTrackCount: 3,
      atRiskCount: 0,
      blockerCount: 0,
      commitmentCount: 4,
    });

  it("is absent with the provider off, and the template stands", async () => {
    await stored();
    expect(await call("sessions.narrateDigest", { sessionId })).toBeNull();
    // The acceptance criterion: the template is still what a provider-off
    // workspace gets, and it is complete.
    const digest = (await call("sessions.digest", { sessionId })) as {
      lines: string[];
    };
    expect(digest.lines).toHaveLength(5);
  });

  it("returns the prose and the lines together, so both are on screen", async () => {
    await stored();
    const narrated = (await call(
      "sessions.narrateDigest",
      { sessionId },
      drafterWith({
        async narrateDigest() {
          return "Confidence sits at 62% with 3 objectives on track and 4 commitments for next week.";
        },
      }),
    )) as { narrative: string; lines: string[] };
    expect(narrated.narrative).toContain("62%");
    expect(narrated.lines).toHaveLength(5);
  });

  it("is dropped when the prose states a figure nobody measured", async () => {
    await stored();
    expect(
      await call(
        "sessions.narrateDigest",
        { sessionId },
        drafterWith({
          async narrateDigest() {
            // 41 was never computed. Plausible, specific, invented.
            return "Confidence sits at 62%, recovering from 41% two weeks ago.";
          },
        }),
      ),
    ).toBeNull();
  });

  it("is shown the lines and nothing else", async () => {
    await stored();
    let seen: readonly string[] = [];
    await call(
      "sessions.narrateDigest",
      { sessionId },
      drafterWith({
        async narrateDigest(context) {
          seen = context.lines;
          return null;
        },
      }),
    );
    expect(seen).toContain("3 objectives on track.");
  });

  it("is dropped when the model throws or says nothing", async () => {
    await stored();
    expect(
      await call(
        "sessions.narrateDigest",
        { sessionId },
        drafterWith({
          async narrateDigest() {
            throw new Error("the provider fell over");
          },
        }),
      ),
    ).toBeNull();
    expect(
      await call(
        "sessions.narrateDigest",
        { sessionId },
        drafterWith({
          async narrateDigest() {
            return "   ";
          },
        }),
      ),
    ).toBeNull();
  });

  it("is absent when an administrator switched it off", async () => {
    const wb = await workerDb();
    await stored();
    await wb.admin.query(
      `insert into ai_feature_settings (id, workspace_id, feature_key, enabled)
       values (gen_random_uuid(), $1, 'assists.narrateDigest', false)`,
      [workspaceId],
    );
    expect(
      await call(
        "sessions.narrateDigest",
        { sessionId },
        drafterWith({
          async narrateDigest() {
            return "Should never be reached.";
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("narrating a KPI trend", () => {
  let kpiId: string;

  /** A metric with a real series, so the numbers the check allows are real. */
  const withSeries = async (values: readonly number[]) => {
    const kpi = (await call("kpis.create", {
      title: "Trial to paid conversion",
      frequency: "monthly",
      direction: "higher_better",
      unit: "%",
      targetDefault: 60,
    })) as { id: string };
    kpiId = kpi.id;
    for (const [index, value] of values.entries()) {
      await call("kpis.record", {
        kpiId,
        on: `2026-0${index + 1}-15`,
        actualValue: value,
        targetValue: 60,
      });
    }
    return kpiId;
  };

  it("is absent with the provider off", async () => {
    await withSeries([41, 44, 48]);
    expect(await call("kpis.narrateTrend", { kpiId })).toBeNull();
  });

  it("is absent for a series with only one point, because that is not a trend", async () => {
    await withSeries([41]);
    expect(
      await call(
        "kpis.narrateTrend",
        { kpiId },
        drafterWith({
          async narrateTrend() {
            return { narrative: "Should never be reached.", anomalies: [] };
          },
        }),
      ),
    ).toBeNull();
  });

  it("returns prose that repeats the series and nothing else", async () => {
    await withSeries([41, 44, 48]);
    const narrated = (await call(
      "kpis.narrateTrend",
      { kpiId },
      drafterWith({
        async narrateTrend() {
          return {
            // Every figure here is in the series, a target, or a difference
            // between two points: 48 - 41 is 7.
            narrative: "It has climbed from 41 to 48 against a target of 60.",
            anomalies: ["The move from 44 to 48 was the largest, at 4."],
          };
        },
      }),
    )) as { narrative: string; anomalies: string[] };
    expect(narrated.narrative).toContain("41 to 48");
    expect(narrated.anomalies).toHaveLength(1);
  });

  it("is dropped when the prose states a value the series does not hold", async () => {
    await withSeries([41, 44, 48]);
    // 52 never happened. This is the test-plan line: a narrated trend never
    // states a number the chart does not hold.
    expect(
      await call(
        "kpis.narrateTrend",
        { kpiId },
        drafterWith({
          async narrateTrend() {
            return {
              narrative: "It has climbed from 41 to 52.",
              anomalies: [],
            };
          },
        }),
      ),
    ).toBeNull();
  });

  it("is dropped when an anomaly states a figure the series does not hold", async () => {
    await withSeries([41, 44, 48]);
    // The narrative is clean and the anomaly is not. Both are checked, because
    // an anomaly is the sentence a reader is most likely to act on.
    expect(
      await call(
        "kpis.narrateTrend",
        { kpiId },
        drafterWith({
          async narrateTrend() {
            return {
              narrative: "It has climbed steadily.",
              anomalies: ["March fell 19 points before recovering."],
            };
          },
        }),
      ),
    ).toBeNull();
  });

  it("is shown the series with its periods and targets", async () => {
    await withSeries([41, 44]);
    let seen: unknown = null;
    await call(
      "kpis.narrateTrend",
      { kpiId },
      drafterWith({
        async narrateTrend(context) {
          seen = context;
          return null;
        },
      }),
    );
    const shown = seen as {
      title: string;
      unit: string | null;
      points: { period: string; value: number; target: number | null }[];
    };
    expect(shown.title).toBe("Trial to paid conversion");
    expect(shown.unit).toBe("%");
    expect(shown.points.map((point) => point.value)).toEqual([41, 44]);
    expect(shown.points[0]?.target).toBe(60);
  });

  it("accepts prose with no numbers in it at all", async () => {
    await withSeries([41, 44, 48]);
    const narrated = (await call(
      "kpis.narrateTrend",
      { kpiId },
      drafterWith({
        async narrateTrend() {
          return {
            narrative: "It has improved every period so far.",
            anomalies: [],
          };
        },
      }),
    )) as { narrative: string };
    // Refusing this would be refusing the most honest kind of summary there is.
    expect(narrated.narrative).toContain("improved every period");
  });
});
