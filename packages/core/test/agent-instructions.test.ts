/**
 * How a run uses an agent's instructions (docs/design/agent-instructions.md,
 * plan 0.7.0 A7, approved 10 November 2026).
 */
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ACTIONS, callAction, getAction } from "../src/actions/registry.ts";
import {
  checkPlannedTasks,
  plannerMenu,
  stageForPhase,
} from "../src/agents/instructions.ts";
import { setPersonalDataFinder } from "../src/ai/personal-data.ts";
import { OperationError } from "../src/operations/errors.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const OWNER = "agent-instructions-owner";
let workspaceId: string;
let spaceIds: string[];

const context = async (drafter?: unknown) => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId: OWNER },
    ...(drafter ? { drafter: drafter as never } : {}),
  };
};

const call = async (name: string, input: unknown, drafter?: unknown) =>
  callAction(await context(drafter), name as never, input as never);

const customAgent = async (planningInstructions = "Draft a plan.") =>
  (
    (await call("agents.create", {
      name: "Helper",
      kind: "custom",
      persona: "",
      planningInstructions,
      executionInstructions: "Keep the week moving.",
      provider: null,
      tier: null,
      schedule: "manual",
      autonomy: "propose",
    })) as { id: string }
  ).id;

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, 'Owner', $2)",
    [OWNER, "agent-instructions@example.com"],
  );
  workspaceId = (
    await provisionWorkspaceForUser(wb.appPool, { id: OWNER, name: "Owner" })
  ).workspaceId;
  await call("spaces.create", { name: "Second space" });
  spaceIds = ((await call("spaces.list", {})) as { id: string }[]).map(
    (space) => space.id,
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the stage a cycle asks for (I1)", () => {
  it("is planning in phases 0 to 5 and execution in 6 and 7", () => {
    expect([0, 1, 2, 3, 4, 5].map(stageForPhase)).toEqual(
      Array(6).fill("planning"),
    );
    expect([6, 7].map(stageForPhase)).toEqual(["execution", "execution"]);
  });
});

describe("versioned instructions (I2)", () => {
  it("start at version 0, the agent's own text, and each save adds a version", async () => {
    const agentId = await customAgent();
    const before = (await call("agents.instructions", { agentId })) as {
      editable: boolean;
      stages: { stage: string; history: { version: number; text: string }[] }[];
    };
    expect(before.editable).toBe(true);
    expect(before.stages[0]?.history).toEqual([
      expect.objectContaining({ version: 0, text: "Draft a plan." }),
    ]);

    const saved = (await call("agents.setInstructions", {
      agentId,
      stage: "planning",
      text: "Look for key results below 0.4 and ask what changed.",
    })) as { version: number };
    expect(saved.version).toBe(1);

    const restored = (await call("agents.restoreInstructions", {
      agentId,
      stage: "planning",
      version: 0,
    })) as { version: number };
    expect(restored.version).toBe(2);

    const after = (await call("agents.instructions", { agentId })) as {
      stages: {
        stage: string;
        history: { version: number; text: string; savedBy: string | null }[];
      }[];
    };
    const planning = after.stages.find((one) => one.stage === "planning");
    expect(planning?.history.map((one) => [one.version, one.text])).toEqual([
      [2, "Draft a plan."],
      [1, "Look for key results below 0.4 and ask what changed."],
      [0, "Draft a plan."],
    ]);
    expect(planning?.history[0]?.savedBy).toBe("Owner");
  });

  it("refuses an email address or phone number, on the field", async () => {
    setPersonalDataFinder((text) => ({
      emails: (text.match(/@/g) ?? []).length,
      phones: 0,
    }));
    const agentId = await customAgent();
    const refused = await call("agents.setInstructions", {
      agentId,
      stage: "planning",
      text: "Write to priya@northwind.example every week.",
    }).catch((error: unknown) => error);
    setPersonalDataFinder(() => ({ emails: 0, phones: 0 }));
    expect(refused).toBeInstanceOf(OperationError);
    expect((refused as OperationError).field).toBe("text");
  });

  it("are read-only for the Coach and the Champion (I8)", async () => {
    const agents = (await call("agents.list", {})) as {
      id: string;
      kind: string;
    }[];
    const coach = agents.find((agent) => agent.kind === "coach");
    if (!coach) {
      throw new Error("no Coach was seeded");
    }
    const read = (await call("agents.instructions", { agentId: coach.id })) as {
      editable: boolean;
    };
    expect(read.editable).toBe(false);
    await expect(
      call("agents.setInstructions", {
        agentId: coach.id,
        stage: "planning",
        text: "Be kinder.",
      }),
    ).rejects.toBeInstanceOf(OperationError);
  });
});

describe("the planner's menu and checks (I4)", () => {
  const menu = plannerMenu(ACTIONS);

  it("offers reads and writes from the everyday toolset, and never a destructive action", () => {
    expect(menu.length).toBeGreaterThan(0);
    for (const choice of menu) {
      expect(getAction(choice.name)?.safety).not.toBe("destructive");
    }
    expect(menu.some((choice) => choice.name === "goals.delete")).toBe(false);
  });

  it("refuses a destructive task, an unknown one, and one with the wrong input, naming it", () => {
    expect(
      checkPlannedTasks(
        [{ action: "goals.delete", input: { id: "x" } }],
        menu,
        getAction,
      ),
    ).toEqual({
      ok: false,
      refused:
        "Task 1, goals.delete, is destructive, and an agent's plan never includes one.",
    });
    expect(
      checkPlannedTasks(
        [{ action: "nothing.here", input: {} }],
        menu,
        getAction,
      ),
    ).toEqual({
      ok: false,
      refused: "Task 1, nothing.here, is not an action.",
    });
    const read = menu.find((choice) => choice.safety === "read");
    expect(
      checkPlannedTasks(
        [{ action: read?.name ?? "", input: { unexpected: 1, also: [] } }],
        menu,
        getAction,
      ).ok,
    ).toBe(false);
  });
});

describe("planning a run (I3, I5, I9)", () => {
  /** A drafter whose planner answers with `tasks`, and records what it saw. */
  const plannerAnswering = (tasks: unknown[]) => {
    const seen: unknown[] = [];
    return {
      seen,
      drafter: {
        spentUsd: () => 0,
        async planRun(context: unknown) {
          seen.push(context);
          return { tasks };
        },
      },
    };
  };

  it("shows the planner only what the agent's bindings reach, and offers checked tasks", async () => {
    const agentId = await customAgent();
    const { id: cycleId } = (await call("cycles.current", {
      mode: "quarterly",
    })) as { id: string };
    const bound = (await call("goals.create", {
      title: "Make onboarding self-serve",
      cycleId,
      spaceId: spaceIds[0],
      level: "team",
      ownerKind: "space",
    })) as { id: string };
    await call("goals.create", {
      title: "Hidden from the agent",
      cycleId,
      spaceId: spaceIds[1],
      level: "team",
      ownerKind: "space",
    });
    await call("agents.bindScope", {
      agentId,
      resourceType: "space",
      resourceId: spaceIds[0],
      level: 10,
    });

    const menu = plannerMenu(ACTIONS);
    const read = menu.find(
      (choice) =>
        choice.safety === "read" &&
        checkPlannedTasks(
          [{ action: choice.name, input: { id: bound.id } }],
          menu,
          getAction,
        ).ok,
    );
    if (!read) {
      throw new Error("no read on the menu takes a goal id");
    }
    const planner = plannerAnswering([
      {
        action: read.name,
        input: { id: bound.id },
        subjectType: "goal",
        subjectId: bound.id,
        why: "See where it stands.",
      },
    ]);

    const planned = (await call(
      "agents.planRun",
      { agentId },
      planner.drafter,
    )) as {
      kind: string;
      tasks: { action: string; why: string }[];
    };

    expect(planned.kind).toBe("planned");
    expect(planned.tasks).toEqual([
      expect.objectContaining({
        action: read.name,
        why: "See where it stands.",
      }),
    ]);
    const shown = planner.seen[0] as {
      instructions: string;
      resources: { title: string }[];
      menu: { name: string }[];
    };
    expect(shown.resources.map((one) => one.title)).toEqual([
      "Make onboarding self-serve",
    ]);
    expect(shown.menu.some((choice) => choice.name === "goals.delete")).toBe(
      false,
    );
  });

  it("refuses a plan naming a destructive action, and starts nothing", async () => {
    const agentId = await customAgent();
    const planner = plannerAnswering([
      {
        action: "goals.delete",
        input: { id: "01a1c0af-0000-7000-8000-000000000001" },
        subjectType: null,
        subjectId: null,
        why: "Tidy up.",
      },
    ]);
    const planned = (await call(
      "agents.planRun",
      { agentId },
      planner.drafter,
    )) as { kind: string; reason: string };
    expect(planned).toMatchObject({
      kind: "refused",
      reason:
        "Task 1, goals.delete, is destructive, and an agent's plan never includes one.",
    });
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select id from agent_runs where agent_id = $1",
      [agentId],
    );
    expect(rows).toEqual([]);
  });

  it("is refused with AI off (I9)", async () => {
    const agentId = await customAgent();
    await expect(call("agents.planRun", { agentId })).rejects.toBeInstanceOf(
      OperationError,
    );
  });
});
