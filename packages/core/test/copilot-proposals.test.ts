/**
 * Copilot proposals (AI-NATIVE-PLAN.md §2.4, P4-T14b-a).
 *
 * The task's test plan: **a proposal the user lacks permission to apply is
 * refused by the permission layer, not hidden by the interface.** Both halves of
 * that sentence are asserted. The panel offers the button; the layer says no.
 *
 * The acceptance criterion: a member asking the copilot to create an objective,
 * approving it, and getting an objective created through the normal Operation
 * with audit, a provenance record and a working undo.
 *
 * **What a model may write here is the thing worth testing.** It picks an action
 * from a list of one, authors a title, a sentence and a level, and points at a
 * space by number. It never sees an identifier. So the tests that matter are the
 * refusals: an action off the list, a number past the end of the list, and a
 * field the schema will not take. All three produce no proposal rather than a
 * proposal built on a guess.
 */
import type { AgentDrafter, ProposalRequestContext } from "@openokr/core";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { proposeFromRequest } from "../src/copilot/proposals.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "proposal-owner";
const OTHER = "proposal-other";

let workspaceId: string;
let ownerMemberId: string;
let otherMemberId: string;
let spaceName: string;
let threadId: string;

/** Returns whatever it was built with, and records what it was shown. */
class ProposingDrafter implements AgentDrafter {
  readonly seen: ProposalRequestContext[] = [];
  #answer: {
    action: string;
    fields: Record<string, unknown>;
    why: string;
  } | null;

  constructor(
    answer: {
      action: string;
      fields: Record<string, unknown>;
      why: string;
    } | null,
  ) {
    this.#answer = answer;
  }

  async proposeAction(context: ProposalRequestContext) {
    this.seen.push(context);
    return this.#answer;
  }

  spentUsd() {
    return 0;
  }
}

const contextFor = async (userId = OWNER, drafter?: AgentDrafter) => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId },
    drafter,
  };
};

const call = async (name: string, input: unknown, userId = OWNER) =>
  callAction(await contextFor(userId), name as never, input as never);

/** A proposal that would create an objective in the first space. */
const objective = (fields: Record<string, unknown> = {}) => ({
  action: "goals.create",
  fields: {
    title: "Raise mid-market activation to sixty per cent",
    description: "The trial-to-paid path is where the quarter is won.",
    level: "team",
    spaceNumber: 1,
    ...fields,
  },
  why: "You asked for an activation objective and this cycle has none.",
});

const propose = async (
  drafter: AgentDrafter | undefined,
  request = "Create an objective for mid-market activation",
) =>
  proposeFromRequest(await contextFor(OWNER, drafter), { threadId, request });

const storedProposals = async () => {
  const wb = await workerDb();
  const { rows } = await wb.admin.query<{
    action: string;
    status: string;
    ai_generated: boolean;
    run_id: string | null;
    thread_id: string | null;
    result: Record<string, unknown> | null;
    undone_at: Date | null;
  }>(
    "select action, status, ai_generated, run_id, thread_id, result, undone_at from proposed_changes",
  );
  return rows;
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Owner', $2), ($3, 'Other', $4)`,
    [OWNER, "proposal-owner@example.com", OTHER, "proposal-other@example.com"],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  const spaces = (await call("spaces.list", {})) as {
    id: string;
    name: string;
  }[];
  spaceName = spaces[0]?.name as string;

  const other = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Other', 'active') returning id`,
    [workspaceId, OTHER],
  );
  otherMemberId = other.rows[0]?.id as string;

  const asked = (await call("copilot.ask", {
    question: "Create an objective for mid-market activation",
  })) as { threadId: string };
  threadId = asked.threadId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("with no provider", () => {
  it("proposes nothing and records nothing", async () => {
    expect(await propose(undefined)).toBeNull();
    expect(await storedProposals()).toEqual([]);
  });
});

describe("what the model is shown", () => {
  it("is one action, with the spaces as labels and no identifiers", async () => {
    const drafter = new ProposingDrafter(objective());
    await propose(drafter);

    const shown = drafter.seen[0];
    expect(shown?.options.map((option) => option.action)).toEqual([
      "goals.create",
    ]);
    expect(shown?.options[0]?.choices.spaces).toEqual([spaceName]);
    // The whole reason choices are labels: there is no id here to copy or alter.
    expect(JSON.stringify(shown?.options)).not.toContain(workspaceId);
  });
});

describe("a proposal the model authored", () => {
  it("is recorded with its preview, its sentence and its provenance", async () => {
    const proposed = await propose(new ProposingDrafter(objective()));
    expect(proposed?.action).toBe("goals.create");

    const stored = await storedProposals();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      action: "goals.create",
      status: "pending",
      // A copilot proposal has no agent run, and saying it did would put a run
      // in the log that nobody scheduled.
      run_id: null,
      // Always true here: a copilot proposal only exists because a model wrote
      // it, unlike §6.5's recovery template.
      ai_generated: true,
    });
    expect(stored[0]?.thread_id).toBe(threadId);

    const listed = (await call("copilot.proposals", { threadId })) as {
      preview: { label: string; value: string }[];
      why: string;
      status: string;
      reversible: boolean;
    }[];
    expect(listed[0]?.status).toBe("pending");
    expect(listed[0]?.reversible).toBe(true);
    expect(listed[0]?.why).toContain("activation objective");
    // Every identifier in the payload is the product's; the preview reads in
    // words, including the space the model only ever saw as a number.
    expect(listed[0]?.preview).toEqual([
      {
        label: "Objective",
        value: "Raise mid-market activation to sixty per cent",
      },
      {
        label: "Description",
        value: "The trial-to-paid path is where the quarter is won.",
      },
      { label: "Level", value: "team" },
      { label: "Space", value: spaceName },
      { label: "Cycle", value: expect.any(String) },
    ]);
  });

  it("is nothing at all when the model names an action off the list", async () => {
    const proposed = await propose(
      new ProposingDrafter({
        action: "people.erase",
        fields: { memberId: otherMemberId },
        why: "Tidying up.",
      }),
    );
    expect(proposed).toBeNull();
    expect(await storedProposals()).toEqual([]);
  });

  it("is nothing when the model points past the end of the list it was shown", async () => {
    // One space was offered. Four is the model miscounting, and resolving it to
    // the first space would put an objective somewhere nobody chose.
    expect(
      await propose(new ProposingDrafter(objective({ spaceNumber: 4 }))),
    ).toBeNull();
    expect(await storedProposals()).toEqual([]);
  });

  it("is nothing when a field does not match the schema", async () => {
    expect(
      await propose(new ProposingDrafter(objective({ title: "" }))),
    ).toBeNull();
    expect(
      await propose(new ProposingDrafter(objective({ level: "galactic" }))),
    ).toBeNull();
    expect(await storedProposals()).toEqual([]);
  });
});

describe("applying one", () => {
  const apply = async (id: string, userId = OWNER) =>
    call("copilot.applyProposal", { id }, userId);

  it("creates the objective through the normal Operation, with audit", async () => {
    const proposed = await propose(new ProposingDrafter(objective()));
    const applied = (await apply(proposed?.id as string)) as {
      result: { id: string } | null;
    };
    const goalId = applied.result?.id as string;
    expect(goalId).toBeTypeOf("string");

    const goal = (await call("goals.read", { id: goalId })) as {
      title: string;
      championId: string;
    };
    expect(goal.title).toBe("Raise mid-market activation to sixty per cent");
    // The asking member, not somebody the model picked: naming who is
    // accountable is not a model's call.
    expect(goal.championId).toBe(ownerMemberId);

    const wb = await workerDb();
    // Through the pipeline means an audit row for the goal's own creation, not
    // only for the decision to apply.
    const audit = await wb.admin.query<{ action: string }>(
      "select action from audit_events where target_id = $1",
      [goalId],
    );
    expect(audit.rows.map((row) => row.action)).toContain("goals.create");

    const stored = await storedProposals();
    expect(stored[0]?.status).toBe("applied");
    expect(stored[0]?.result).toMatchObject({ id: goalId });
  });

  it("refuses a second decision on the same proposal", async () => {
    const proposed = await propose(new ProposingDrafter(objective()));
    await apply(proposed?.id as string);
    await expect(apply(proposed?.id as string)).rejects.toThrow(
      /already been decided/,
    );
  });

  it("is refused by the permission layer, not hidden by the interface", async () => {
    const proposed = await propose(new ProposingDrafter(objective()));
    const wb = await workerDb();

    // Their own proposal, in their own conversation, and `copilot.applyProposal`
    // asks for `comment`, so the panel offers the button and nothing here hides
    // it. What refuses is `goals.create`'s own `edit`, exactly as it would if
    // they had typed the objective themselves. That is the whole test-plan line.
    await wb.admin.query(
      "update access_bindings set level = 40 where workspace_id = $1",
      [workspaceId],
    );

    await expect(apply(proposed?.id as string)).rejects.toThrow();

    // Nothing was created on the way to that refusal, and the proposal is still
    // pending rather than marked applied.
    const goals = await wb.admin.query<{ count: string }>(
      "select count(*) from goals",
    );
    expect(goals.rows[0]?.count).toBe("0");
    expect((await storedProposals())[0]?.status).toBe("pending");
  });

  it("does not exist for another member", async () => {
    const proposed = await propose(new ProposingDrafter(objective()));
    await expect(
      call("copilot.proposals", { threadId }, OTHER),
    ).rejects.toThrow(/No such conversation/);
    await expect(apply(proposed?.id as string, OTHER)).rejects.toThrow(
      /No such proposal/,
    );
  });
});

describe("undoing one", () => {
  it("is refused for a member who may not remove what it created", async () => {
    const proposed = await propose(new ProposingDrafter(objective()));
    await call("copilot.applyProposal", { id: proposed?.id as string });

    const wb = await workerDb();
    // P3-T01's binding gives this member `edit`, which is enough to create an
    // objective and not enough to remove one. The undo is offered and the layer
    // refuses it, which is the access model answering rather than the copilot
    // inventing a right.
    await wb.admin.query(
      "update access_bindings set level = 70 where workspace_id = $1",
      [workspaceId],
    );

    await expect(
      call("copilot.undoProposal", { id: proposed?.id as string }),
    ).rejects.toThrow();
  });

  it("removes the objective and says so on the proposal", async () => {
    const proposed = await propose(new ProposingDrafter(objective()));
    const applied = (await call("copilot.applyProposal", {
      id: proposed?.id as string,
    })) as { result: { id: string } | null };
    const goalId = applied.result?.id as string;

    await call("copilot.undoProposal", { id: proposed?.id as string });

    // Gone from every read, because soft delete is the default scope.
    await expect(call("goals.read", { id: goalId })).rejects.toThrow();
    const stored = await storedProposals();
    // Still applied, and now also undone. Both are true, and the record says so
    // rather than pretending the objective never existed.
    expect(stored[0]?.status).toBe("applied");
    expect(stored[0]?.undone_at).not.toBeNull();

    const wb = await workerDb();
    // Undo is a write with its own audit row, not a rollback.
    const audit = await wb.admin.query<{ action: string }>(
      "select action from audit_events where target_id = $1",
      [goalId],
    );
    expect(audit.rows.map((row) => row.action)).toContain("goals.delete");
  });

  it("refuses a second undo, and refuses undoing what was never applied", async () => {
    const proposed = await propose(new ProposingDrafter(objective()));
    await expect(
      call("copilot.undoProposal", { id: proposed?.id as string }),
    ).rejects.toThrow(/Only an applied proposal/);

    await call("copilot.applyProposal", { id: proposed?.id as string });
    await call("copilot.undoProposal", { id: proposed?.id as string });
    await expect(
      call("copilot.undoProposal", { id: proposed?.id as string }),
    ).rejects.toThrow(/already undone/);
  });
});

describe("dismissing one", () => {
  it("changes nothing but the proposal", async () => {
    const proposed = await propose(new ProposingDrafter(objective()));
    await call("copilot.dismissProposal", { id: proposed?.id as string });

    const stored = await storedProposals();
    expect(stored[0]?.status).toBe("dismissed");
    const wb = await workerDb();
    const goals = await wb.admin.query<{ count: string }>(
      "select count(*) from goals",
    );
    expect(goals.rows[0]?.count).toBe("0");
  });

  it("cannot be applied afterwards", async () => {
    const proposed = await propose(new ProposingDrafter(objective()));
    await call("copilot.dismissProposal", { id: proposed?.id as string });
    await expect(
      call("copilot.applyProposal", { id: proposed?.id as string }),
    ).rejects.toThrow(/already been decided/);
  });
});

describe("a copilot proposal is not the workspace's reading", () => {
  it("keeps its own activity out of the feed, and the change's own activity in", async () => {
    const proposed = await propose(new ProposingDrafter(objective()));
    await call("copilot.applyProposal", { id: proposed?.id as string });

    const feed = (await call("activities.workspaceFeed", {})) as {
      kind: string;
    }[];
    // The proposal, the apply and the dismiss are conversation events.
    expect(feed.filter((item) => item.kind.startsWith("copilot."))).toEqual([]);
    // What it actually did is not: an objective was created, and the space
    // should read about it.
    expect(feed.map((item) => item.kind)).toContain("goal.created");
  });
});
