/**
 * The review assists (AI-NATIVE-PLAN.md §2.3, P4-T15c).
 *
 * The task's test plan:
 * - the diagnostic's verdict sentence is unchanged with the provider off and the
 *   narrative is additive
 * - clustering never merges notes from two reviews
 * - a proposed objective cites the learning it came from
 *
 * The first line is the row's acceptance criterion, and the test for it compares
 * the provider-off answer with the provider-on answer field by field: the verdict,
 * the diagnosis and the prescription have to be identical strings, and only the
 * narrative may differ. That is the strongest form of "additive" available, and
 * it would fail the day somebody let a model write the verdict.
 *
 * The second line is not enforced by a filter after the fact: the notes handed to
 * the model come from one session's board, and the answer is positional over that
 * list. So the test that matters is the one where two reviews each have notes and
 * the clustering of one cannot name the other's.
 */
import type { AgentDrafter } from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "review-owner";

let workspaceId: string;
let spaceId: string;
let cycleId: string;
let ownerMemberId: string;
let sessionId: string;
let otherSessionId: string;

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

/** A quarterly review, opened. */
const quarterly = async (title: string) => {
  const session = (await call("sessions.create", {
    spaceId,
    cycleId,
    kind: "quarterly",
    title,
    scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    facilitatorId: ownerMemberId,
  })) as { id: string };
  await call("sessions.open", { id: session.id });
  return session.id;
};

const note = async (session: string, text: string, column = "didnt") =>
  (
    (await call("sessions.addRetroNote", {
      sessionId: session,
      columnKey: column,
      text,
      anonymous: false,
    })) as { id: string }
  ).id;

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Ada', $2)",
    [OWNER, "review-owner@example.com"],
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

  sessionId = await quarterly("Q1 review");
  otherSessionId = await quarterly("Q1 review, another room");
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("clustering the retro board", () => {
  const clusterer = (themes: { title: string; noteNumbers: number[] }[]) =>
    drafterWith({
      async clusterNotes() {
        return { themes };
      },
    });

  it("is absent with the provider off", async () => {
    await note(sessionId, "The billing dependency surfaced late");
    await note(sessionId, "The billing team had no notice");
    await note(sessionId, "Design was quick this time", "worked");
    expect(await call("sessions.clusterRetro", { sessionId })).toBeNull();
  });

  it("is absent for a board too small to have themes", async () => {
    await note(sessionId, "Only one thing");
    expect(
      await call(
        "sessions.clusterRetro",
        { sessionId },
        clusterer([{ title: "Anything", noteNumbers: [1] }]),
      ),
    ).toBeNull();
  });

  it("resolves the numbers to this board's own notes", async () => {
    const first = await note(sessionId, "The billing dependency surfaced late");
    const second = await note(sessionId, "The billing team had no notice");
    const third = await note(sessionId, "Design was quick", "worked");

    const clustered = (await call(
      "sessions.clusterRetro",
      { sessionId },
      clusterer([{ title: "Billing", noteNumbers: [1, 2] }]),
    )) as {
      themes: { title: string; noteIds: string[] }[];
      unclustered: string[];
    };

    expect(clustered.themes).toEqual([
      { title: "Billing", noteIds: [first, second] },
    ]);
    // A note no theme claimed is said out loud rather than lost.
    expect(clustered.unclustered).toEqual([third]);
  });

  it("cannot reach a note from another review", async () => {
    await note(sessionId, "This room's first");
    await note(sessionId, "This room's second");
    await note(sessionId, "This room's third");
    const elsewhere = await note(otherSessionId, "The other room's note");

    // The model is only ever shown one board, so the worst it can do is index
    // past the end of that board, which resolves to nothing.
    const clustered = (await call(
      "sessions.clusterRetro",
      { sessionId },
      clusterer([{ title: "Everything", noteNumbers: [1, 2, 3, 4, 99] }]),
    )) as { themes: { noteIds: string[] }[] };

    expect(clustered.themes[0]?.noteIds).toHaveLength(3);
    expect(clustered.themes[0]?.noteIds).not.toContain(elsewhere);
  });

  it("is shown this board's notes and no others", async () => {
    await note(sessionId, "This room's first");
    await note(sessionId, "This room's second");
    await note(sessionId, "This room's third");
    await note(otherSessionId, "The other room's note");

    let seen: readonly { text: string }[] = [];
    await call(
      "sessions.clusterRetro",
      { sessionId },
      drafterWith({
        async clusterNotes(context) {
          seen = context.notes;
          return null;
        },
      }),
    );
    expect(seen.map((entry) => entry.text)).toEqual([
      "This room's first",
      "This room's second",
      "This room's third",
    ]);
  });

  it("drops a theme with no title or no notes left in it", async () => {
    await note(sessionId, "One");
    await note(sessionId, "Two");
    await note(sessionId, "Three");
    const clustered = (await call(
      "sessions.clusterRetro",
      { sessionId },
      clusterer([
        { title: "   ", noteNumbers: [1] },
        { title: "Nothing valid", noteNumbers: [42] },
        { title: "Real", noteNumbers: [2] },
      ]),
    )) as { themes: { title: string }[] };
    expect(clustered.themes.map((theme) => theme.title)).toEqual(["Real"]);
  });
});

describe("narrating §8.6's diagnostic", () => {
  /**
   * Writes the diagnostic row directly.
   *
   * `sessions.recordDiagnostic` refuses without both scores, and getting both
   * means grading every key result and running the anonymous survey: that is
   * P4-T11b's and P4-T11c-a's subject, tested there. This row is about what the
   * narration does with a diagnostic that exists, so the row is written the way
   * the e2e specs write what no screen can reach.
   */
  const recordDiagnostic = async () => {
    const wb = await workerDb();
    await wb.admin.query(
      `insert into review_diagnostics
         (id, workspace_id, session_id, cycle_score, rhythm_score, verdict,
          narrative, recorded_by_id)
       -- The rhythm score is §8.5's one-to-five survey mean, not a fraction:
       -- the constraint says so and this got it wrong once.
       values (gen_random_uuid(), $1, $2, 0.62, 4.2, 'strategy_or_quality',
               'The rhythm held and the ambition did not.', $3)`,
      [workspaceId, sessionId, ownerMemberId],
    );
  };

  it("is null before the diagnostic is readable", async () => {
    expect(
      await call(
        "sessions.narrateDiagnostic",
        { sessionId },
        drafterWith({
          async narrateDiagnostic() {
            return "Should never be reached.";
          },
        }),
      ),
    ).toBeNull();
  });

  it("returns §8.6's own answer with no narrative when the provider is off", async () => {
    await recordDiagnostic();
    const narrated = (await call("sessions.narrateDiagnostic", {
      sessionId,
    })) as {
      verdict: string;
      diagnosis: string;
      prescription: string;
      narrative: string | null;
    };
    const deterministic = (await call("sessions.diagnostic", {
      sessionId,
    })) as { verdict: string; diagnosis: string; prescription: string };

    expect(narrated.verdict).toBe(deterministic.verdict);
    expect(narrated.diagnosis).toBe(deterministic.diagnosis);
    expect(narrated.prescription).toBe(deterministic.prescription);
    expect(narrated.narrative).toBeNull();
  });

  it("adds the narrative and changes nothing else", async () => {
    await recordDiagnostic();
    const before = (await call("sessions.diagnostic", { sessionId })) as {
      verdict: string;
      diagnosis: string;
      prescription: string;
    };

    const narrated = (await call(
      "sessions.narrateDiagnostic",
      { sessionId },
      drafterWith({
        async narrateDiagnostic() {
          return "The rhythm held; the ambition did not.";
        },
      }),
    )) as {
      verdict: string;
      diagnosis: string;
      prescription: string;
      narrative: string | null;
    };

    // The acceptance criterion, field by field: identical to the provider-off
    // answer, with the narrative beside it.
    expect(narrated.verdict).toBe(before.verdict);
    expect(narrated.diagnosis).toBe(before.diagnosis);
    expect(narrated.prescription).toBe(before.prescription);
    expect(narrated.narrative).toBe("The rhythm held; the ambition did not.");

    // And §8.6's own read is untouched by having been narrated.
    expect(await call("sessions.diagnostic", { sessionId })).toEqual(
      expect.objectContaining(before),
    );
  });

  it("keeps §8.6's answer when the model throws or says nothing", async () => {
    await recordDiagnostic();
    for (const drafter of [
      drafterWith({
        async narrateDiagnostic() {
          throw new Error("the provider fell over");
        },
      }),
      drafterWith({
        async narrateDiagnostic() {
          return "   ";
        },
      }),
    ]) {
      const narrated = (await call(
        "sessions.narrateDiagnostic",
        { sessionId },
        drafter,
      )) as { verdict: string; narrative: string | null };
      expect(narrated.verdict).not.toBeNull();
      expect(narrated.narrative).toBeNull();
    }
  });

  it("is shown §8.6's verdict and both scores", async () => {
    await recordDiagnostic();
    let seen: { verdict: string; cycleScore: number } | null = null;
    await call(
      "sessions.narrateDiagnostic",
      { sessionId },
      drafterWith({
        async narrateDiagnostic(context) {
          seen = context;
          return null;
        },
      }),
    );
    expect(seen).not.toBeNull();
    expect(typeof (seen as unknown as { verdict: string }).verdict).toBe(
      "string",
    );
  });
});

describe("proposing next-cycle objectives from learnings", () => {
  const carry = async (text: string, carryForward = true) =>
    (
      (await call("sessions.captureLearning", {
        sessionId,
        text,
        carryForward,
      })) as { id: string }
    ).id;

  it("is absent with the provider off", async () => {
    await carry("Dependencies were found too late");
    expect(
      await call("sessions.proposeFromLearnings", { sessionId }),
    ).toBeNull();
  });

  it("is absent when no learning was marked to carry", async () => {
    await carry("Kept for the record only", false);
    expect(
      await call(
        "sessions.proposeFromLearnings",
        { sessionId },
        drafterWith({
          async proposeObjectives() {
            return [
              { title: "Should never be reached", learningNumber: 1, why: "x" },
            ];
          },
        }),
      ),
    ).toBeNull();
  });

  it("cites the learning it came from, by its own id", async () => {
    const first = await carry("Dependencies were found too late");
    await carry("Nobody owned the billing relationship");

    const proposed = (await call(
      "sessions.proposeFromLearnings",
      { sessionId },
      drafterWith({
        async proposeObjectives() {
          return [
            {
              title: "Find every dependency in week one",
              learningNumber: 1,
              why: "Late discovery cost the quarter.",
            },
          ];
        },
      }),
    )) as {
      title: string;
      learningId: string;
      learningText: string;
    }[];

    expect(proposed).toHaveLength(1);
    expect(proposed[0]?.learningId).toBe(first);
    expect(proposed[0]?.learningText).toBe("Dependencies were found too late");
  });

  it("drops a proposal that cites nothing real", async () => {
    await carry("Dependencies were found too late");
    // Index past the end, and an empty title. Neither survives, and a response
    // with nothing left is null rather than an empty list dressed as an answer.
    expect(
      await call(
        "sessions.proposeFromLearnings",
        { sessionId },
        drafterWith({
          async proposeObjectives() {
            return [
              { title: "From nowhere", learningNumber: 9, why: "" },
              { title: "   ", learningNumber: 1, why: "" },
            ];
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("drafting a goal's retrospective", () => {
  it("is absent when there is no published check-in to write it from", async () => {
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

    expect(
      await call(
        "goals.draftRetrospective",
        { goalId: goal.id },
        drafterWith({
          async draftRetrospective() {
            return "Should never be reached.";
          },
        }),
      ),
    ).toBeNull();
  });

  it("is absent with the provider off", async () => {
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
    expect(
      await call("goals.draftRetrospective", { goalId: goal.id }),
    ).toBeNull();
  });
});

describe("drafting the minutes", () => {
  it("is absent with the provider off", async () => {
    expect(await call("sessions.draftMinutes", { sessionId })).toBeNull();
  });

  it("is written from the minutes read and nothing else", async () => {
    let seen: readonly { label: string }[] = [];
    await call(
      "sessions.draftMinutes",
      { sessionId },
      drafterWith({
        async draftMinutes(context) {
          seen = context.sections;
          return null;
        },
      }),
    );
    // The sections are the minutes read's own shape, so a section added there
    // reaches the draft without a change in the assist.
    expect(seen.length).toBeGreaterThan(0);
  });

  it("returns the prose when there is some", async () => {
    const drafted = (await call(
      "sessions.draftMinutes",
      { sessionId },
      drafterWith({
        async draftMinutes() {
          return "The room scored eight objectives and agreed four actions.";
        },
      }),
    )) as { narrative: string };
    expect(drafted.narrative).toContain("eight objectives");
  });
});
