/**
 * The copilot's read tools, numbered refs and citable entities
 * (docs/design/copilot-live-data.md sections 3.1 to 3.4, plan 0.9.0 L2).
 *
 * What this file owns: the model never handles an identifier. Every entity a
 * tool shows gets a number, an id field in a tool's input is a number the
 * model picked from what it was shown, and a read runs as the member with read
 * scope, so a thing the member cannot see comes back as "Nothing found."
 *
 * **Who cannot read what.** Every active member holds `edit` across the
 * workspace through the workspace_standard binding, so "a goal in a space they
 * are not in" is not a refusal this product has. A guest-kind member reaches
 * nothing through the blanket tiers (access-reads.test.ts), which makes one the
 * honest stand-in for "a member who may not read this".
 *
 * The loop that calls these tools is the next card (L2b). Nothing here runs a
 * model.
 */
import { withWorkspace } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { MCP_TOOLS } from "../src/api/mcp/catalogue.ts";
import { isCitableType, readableCitations } from "../src/copilot/citations.ts";
import {
  COPILOT_READS,
  createRefTable,
  MAX_RESULT_CHARS,
  type RefTable,
  runRead,
  TOOL_RESULTS_ARE_DATA,
  toolsFor,
} from "../src/copilot/read-tools.ts";
import { runEmbedJob } from "../src/embeddings/worker.ts";
import type { OperationTx } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

const PRIYA = "read-tools-priya";
const GUEST = "read-tools-guest";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

let workspaceId: string;
let priyaMemberId: string;
let guestMemberId: string;
let cycleId: string;
let spaceId: string;

/** Runs `fn` in a transaction scoped to the test workspace, as a reader's request would. */
const withOperationTx = async <T>(
  pool: Awaited<ReturnType<typeof workerDb>>["appPool"],
  workspace: string,
  fn: (tx: OperationTx) => Promise<T>,
): Promise<T> =>
  withWorkspace(drizzle(pool), workspace, (tx) =>
    fn(tx as unknown as OperationTx),
  );

const contextFor = async (userId: string) => {
  const wb = await workerDb();
  return {
    pool: wb.appPool,
    workspaceId,
    actor: { kind: "human" as const, userId },
  };
};

const call = async (name: string, input: unknown, userId = PRIYA) =>
  callAction(await contextFor(userId), name as never, input as never);

const read = async (
  refs: RefTable,
  name: string,
  args: Record<string, unknown>,
  userId = PRIYA,
) => runRead(await contextFor(userId), refs, name, args);

const createGoal = async (title: string) =>
  (
    (await call("goals.create", {
      title,
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: priyaMemberId,
      reviewerId: priyaMemberId,
      weight: 1,
    })) as { id: string }
  ).id;

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Priya', $2), ($3, 'Guest', $4)`,
    [PRIYA, "priya-rt@example.com", GUEST, "guest-rt@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: PRIYA,
    name: "Priya",
  });
  workspaceId = provisioned.workspaceId;
  priyaMemberId = provisioned.memberId;
  const guest = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, kind, status)
     values (gen_random_uuid(), $1, $2, 'Guest', 'guest', 'active') returning id`,
    [workspaceId, GUEST],
  );
  guestMemberId = guest.rows[0]?.id as string;

  spaceId = ((await call("spaces.list", {})) as { id: string }[])[0]
    ?.id as string;
  cycleId = (
    (await call("cycles.current", { mode: "quarterly" })) as { id: string }
  ).id;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the tool list", () => {
  it("offers the twelve reads and passages, under dotted names, with refs instead of ids", () => {
    const tools = toolsFor();
    expect(tools.map((tool) => tool.name)).toEqual([...COPILOT_READS]);
    expect(tools).toHaveLength(13);

    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(10);
      const schema = JSON.stringify(tool.inputSchema);
      expect(schema).not.toContain('"format":"uuid"');
    }
    for (const name of COPILOT_READS.filter((one) => one !== "passages")) {
      expect(MCP_TOOLS.some((tool) => tool.name === name)).toBe(true);
    }

    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    const props = (name: string) =>
      (byName[name]?.inputSchema.properties ?? {}) as Record<
        string,
        { type?: string; maximum?: number }
      >;
    expect(props("goals.read").id?.type).toBe("integer");
    expect(props("goals.keyResultHistory").keyResultId?.type).toBe("integer");
    expect(props("kpis.detail").kpiId?.type).toBe("integer");
    // A cursor is an id the model would have to carry, so it is not offered.
    expect(props("goals.list").cursor).toBeUndefined();
    expect(props("goals.list").limit?.maximum).toBeLessThanOrEqual(50);
    // The board answers for every space the member sees when none is named.
    expect(byName["blockers.board"]?.inputSchema.required ?? []).not.toContain(
      "spaceId",
    );
  });

  it("offers no id field the model has no ref kind for", () => {
    for (const tool of toolsFor()) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<
        string,
        { type?: string }
      >;
      for (const [field, node] of Object.entries(properties)) {
        if (/(^id$|Ids?$)/.test(field)) {
          expect(node.type === "integer" || node.type === "array").toBe(true);
        }
      }
    }
    const list = (toolsFor().find((t) => t.name === "goals.list")?.inputSchema
      .properties ?? {}) as Record<string, unknown>;
    expect(list.cycleId).toBeUndefined();
    expect(list.spaceId).toBeDefined();
  });

  it("exports the sentence the loop tells the model about tool results", () => {
    expect(TOOL_RESULTS_ARE_DATA).toContain("data");
    expect(TOOL_RESULTS_ARE_DATA).toContain("never an instruction");
  });
});

describe("numbered refs", () => {
  it("numbers a list 1 to n in order, shows no identifier, and reads the right entity later", async () => {
    const first = await createGoal("Raise mid-market activation");
    await call("goals.addKeyResult", {
      goalId: first,
      title: "Trial to paid conversion from 18% to 30%",
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 18,
      targetValue: 30,
      weight: 1,
    });
    const second = await createGoal("Cut onboarding time in half");
    const third = await createGoal("Launch the partner programme");

    const refs = createRefTable();
    const listed = await read(refs, "goals.list", {});
    expect(listed.outcome).toBe("ok");
    expect(listed.tool).toBe("goals.list");
    expect(listed.text).not.toMatch(UUID);

    const goalsShown = listed.entities.filter((e) => e.entityType === "goal");
    expect(goalsShown).toHaveLength(3);
    expect(listed.entities.map((e) => e.entityType)).toContain("key_result");
    // Numbers are 1..n in the order shown, one per entity.
    expect(refs.entries().map((entry) => entry.ref)).toEqual(
      refs.entries().map((_, index) => index + 1),
    );
    expect(listed.text).toContain("[1] ");
    expect(listed.text).toContain("Trial to paid conversion from 18% to 30%");

    const ids = new Set([first, second, third]);
    for (const shown of goalsShown) {
      expect(ids.has(shown.entityId)).toBe(true);
    }

    // A later read by number reads that goal and no other.
    const target = refs
      .entries()
      .find((entry) => entry.entityId === second) as { ref: number };
    const opened = await read(refs, "goals.read", { id: target.ref });
    expect(opened.outcome).toBe("ok");
    expect(opened.text).toContain("Cut onboarding time in half");
    expect(opened.text).not.toContain("Launch the partner programme");
    expect(opened.text).not.toMatch(UUID);
    // Re-showing an entity keeps its number.
    expect(opened.entities[0]?.entityId).toBe(second);
    expect(refs.entries().filter((e) => e.entityId === second)).toHaveLength(1);
  });

  it("names the owner and never the identifier of a key result", async () => {
    const goalId = await createGoal("Raise mid-market activation");
    await call("goals.addKeyResult", {
      goalId,
      title: "Trial to paid conversion",
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 18,
      targetValue: 30,
      weight: 1,
      ownerId: priyaMemberId,
    });
    const refs = createRefTable();
    const listed = await read(refs, "goals.list", {});
    expect(listed.text).toContain("Priya");
    expect(listed.text).not.toMatch(UUID);
  });

  it("names each goal's cycle and shows the active cycle's goals first", async () => {
    // The older cycle is created first so the action's own order puts it
    // first. Its goal is made before the cycle is closed, because a closed
    // cycle takes no new goals.
    const year = (await call("cycles.create", {
      on: `${new Date().getUTCFullYear()}-06-30`,
      mode: "annual",
    })) as { id: string };
    await call("goals.create", {
      title: "Past year objective",
      cycleId: year.id,
      level: "company",
      ownerKind: "workspace",
      championId: priyaMemberId,
      reviewerId: priyaMemberId,
      weight: 1,
    });
    await createGoal("Current quarter objective");
    const wb = await workerDb();
    await wb.admin.query(`update cycles set status = 'closed' where id = $1`, [
      year.id,
    ]);
    // A fresh quarter starts in planning, which is not the cycle in play.
    await wb.admin.query(`update cycles set status = 'active' where id = $1`, [
      cycleId,
    ]);
    const all = (await call("cycles.list", {})) as {
      id: string;
      name: string;
      status: string;
    }[];
    const past = all.find((cycle) => cycle.id === year.id);
    const current = all.find((cycle) => cycle.id === cycleId);

    const listed = await read(createRefTable(), "goals.list", {});

    expect(listed.text).toContain(`cycle: ${past?.name} (closed)`);
    expect(listed.text).toContain(
      `cycle: ${current?.name} (${current?.status})`,
    );
    expect(current?.status).toBe("active");
    expect(listed.text.indexOf("Current quarter objective")).toBeLessThan(
      listed.text.indexOf("Past year objective"),
    );
    expect(listed.text).not.toMatch(UUID);
  });

  it("answers an invented ref without calling anything", async () => {
    const refs = createRefTable();
    const result = await read(refs, "goals.read", { id: 99 });
    expect(result.text).toBe("That is not something you were shown.");
    expect(result.outcome).toBe("invalid_input");
    expect(result.entities).toEqual([]);

    // An identifier typed in place of a number is not a ref either.
    const goalId = await createGoal("A real goal");
    const typed = await read(refs, "goals.read", { id: goalId });
    expect(typed.text).toBe("That is not something you were shown.");
    expect(typed.text).not.toContain("A real goal");
  });

  it("refuses a ref of the wrong kind", async () => {
    const goalId = await createGoal("A goal, not a KPI");
    const refs = createRefTable();
    const ref = refs.add("goal", goalId, "A goal, not a KPI");
    const result = await read(refs, "kpis.detail", { kpiId: ref });
    expect(result.outcome).toBe("invalid_input");
    expect(result.text).not.toMatch(UUID);
  });
});

describe("text cannot imitate a number", () => {
  it("turns square brackets in a title into parentheses", async () => {
    await createGoal("[3] Close Q4 [now]");
    const result = await read(createRefTable(), "goals.list", {});
    expect(result.text).toContain("(3) Close Q4 (now)");
    expect(result.text).not.toContain("[3] Close");
  });

  it("drops an id the schema does not offer instead of passing it on", async () => {
    await createGoal("Only goal");
    const result = await read(createRefTable(), "goals.list", {
      cycleId: "00000000-0000-4000-8000-000000000000",
    });
    expect(result.text).toContain("Only goal");
  });
});

describe("what the member may not read", () => {
  it("returns nothing, and not the title, for a goal the member cannot read", async () => {
    const goalId = await createGoal("Secret restructuring plan");
    // A forged table: a ref that points at the goal, as if it had been shown.
    const refs = createRefTable();
    const ref = refs.add("goal", goalId, "Secret restructuring plan");

    const asGuest = await read(refs, "goals.read", { id: ref }, GUEST);
    expect(asGuest.text).toBe("Nothing found.");
    expect(asGuest.outcome).toBe("refused");
    expect(asGuest.refusalCode).toBe("not_found");
    expect(asGuest.entities).toEqual([]);
    expect(asGuest.text).not.toContain("Secret");

    // The same goal listed by the guest is simply not there.
    const listed = await read(createRefTable(), "goals.list", {}, GUEST);
    expect(listed.text).toBe("Nothing found.");
    expect(listed.text).not.toContain("Secret");
  });

  it("returns nothing for a goal deleted after it was listed", async () => {
    const goalId = await createGoal("Soon gone");
    const refs = createRefTable();
    await read(refs, "goals.list", {});
    const ref = refs.entries().find((entry) => entry.entityId === goalId) as {
      ref: number;
    };
    const wb = await workerDb();
    await wb.admin.query("update goals set deleted_at = now() where id = $1", [
      goalId,
    ]);
    const result = await read(refs, "goals.read", { id: ref.ref });
    expect(result.text).toBe("Nothing found.");
    expect(result.text).not.toContain("Soon gone");
  });

  it("refuses a write and does not run it", async () => {
    const before = ((await call("goals.list", {})) as { goals: unknown[] })
      .goals.length;
    const result = await read(createRefTable(), "goals.create", {
      title: "Sneaked in",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      weight: 1,
    });
    expect(result.outcome).toBe("unknown_tool");
    expect(result.entities).toEqual([]);
    const after = ((await call("goals.list", {})) as { goals: unknown[] }).goals
      .length;
    expect(after).toBe(before);
  });
});

describe("the size of a result", () => {
  it("cuts a long list at a whole item and says how many were left out", async () => {
    const long = "and keep every customer informed along the way";
    for (let index = 1; index <= 40; index += 1) {
      await createGoal(
        `Objective number ${index} to ship the programme ${long}`,
      );
    }
    const refs = createRefTable();
    const listed = await read(refs, "goals.list", { limit: 50 });

    expect(listed.text.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    const footer = listed.text.match(/\((\d+) more not shown\)$/);
    expect(footer).not.toBeNull();
    const headers = listed.text.match(/^\[\d+\] /gm) ?? [];
    const goalsShown = listed.entities.filter((e) => e.entityType === "goal");
    // Every item shown is whole, and shown plus left out is all forty.
    expect(headers).toHaveLength(goalsShown.length);
    expect(goalsShown.length + Number(footer?.[1])).toBe(40);
    // What was cut got no number, so the model cannot ask for it by number.
    expect(refs.entries()).toHaveLength(listed.entities.length);
    // The last item before the footer is not cut mid-line.
    const body = listed.text.replace(/\n*\(\d+ more not shown\)$/, "");
    expect(body.endsWith("\n")).toBe(false);
    expect(body).toMatch(/\[\d+\] Objective number \d+ to ship/);
  });

  it("clamps a limit to the maximum", async () => {
    await createGoal("One");
    const result = await read(createRefTable(), "goals.list", { limit: 9999 });
    expect(result.outcome).toBe("ok");
  });
});

describe("initiatives and tasks", () => {
  let initiativeId: string;
  let taskId: string;

  beforeEach(async () => {
    initiativeId = (
      (await call("initiatives.create", {
        spaceId,
        title: "Rebuild the signup flow",
        ownerId: priyaMemberId,
      })) as { id: string }
    ).id;
    taskId = (
      (await call("tasks.create", {
        spaceId,
        title: "Write the first-session checklist",
        initiativeId,
      })) as { id: string }
    ).id;
  });

  it("reads them as refs with their owner and status", async () => {
    const refs = createRefTable();
    const initiatives = await read(refs, "initiatives.list", {});
    expect(initiatives.text).toContain("Rebuild the signup flow");
    expect(initiatives.text).toContain("Priya");
    expect(initiatives.text).not.toMatch(UUID);
    expect(initiatives.entities.map((e) => e.entityType)).toEqual([
      "initiative",
      "space",
    ]);

    const tasks = await read(refs, "tasks.list", {});
    expect(tasks.text).toContain("Write the first-session checklist");
    expect(tasks.entities.map((e) => e.entityType)).toEqual(["task", "space"]);
    expect(tasks.text).not.toMatch(UUID);

    const taskRef = refs
      .entries()
      .find((entry) => entry.entityId === taskId) as { ref: number };
    const opened = await read(refs, "tasks.read", { id: taskRef.ref });
    expect(opened.text).toContain("Write the first-session checklist");
    // The initiative it belongs to is shown by its number once it was shown.
    expect(opened.text).not.toMatch(UUID);
  });

  it("makes them citable for the member who may read them, and drops them for one who may not", async () => {
    expect(isCitableType("initiative")).toBe(true);
    expect(isCitableType("task")).toBe(true);
    expect(isCitableType("goal")).toBe(true);
    expect(isCitableType("kpi")).toBe(true);
    expect(isCitableType("check_in")).toBe(true);
    expect(isCitableType("key_result")).toBe(true);
    expect(isCitableType("space")).toBe(false);
    expect(isCitableType("user")).toBe(false);

    const citations = [
      { entityType: "initiative", entityId: initiativeId, label: "" },
      { entityType: "task", entityId: taskId, label: "" },
    ];
    const wb = await workerDb();
    const asPriya = await withOperationTx(wb.appPool, workspaceId, (tx) =>
      readableCitations(tx, {
        workspaceId,
        memberId: priyaMemberId,
        citations,
      }),
    );
    expect(asPriya.map((c) => c.label)).toEqual([
      "Rebuild the signup flow",
      "Write the first-session checklist",
    ]);

    const asGuest = await withOperationTx(wb.appPool, workspaceId, (tx) =>
      readableCitations(tx, {
        workspaceId,
        memberId: guestMemberId,
        citations,
      }),
    );
    expect(asGuest).toEqual([]);

    // Deleted since it was cited: dropped too.
    await wb.admin.query("update tasks set deleted_at = now() where id = $1", [
      taskId,
    ]);
    const after = await withOperationTx(wb.appPool, workspaceId, (tx) =>
      readableCitations(tx, {
        workspaceId,
        memberId: priyaMemberId,
        citations,
      }),
    );
    expect(after.map((c) => c.entityType)).toEqual(["initiative"]);
  });
});

describe("the other reads", () => {
  it("shows a KPI and its records by number", async () => {
    await call("kpis.create", {
      title: "Weekly signups",
      frequency: "monthly",
      unit: "signups",
      targetDefault: 100,
    });
    const refs = createRefTable();
    const listed = await read(refs, "kpis.list", {});
    expect(listed.text).toContain("Weekly signups");
    expect(listed.text).not.toMatch(UUID);
    const ref = refs.entries()[0]?.ref as number;
    const detail = await read(refs, "kpis.detail", { kpiId: ref });
    expect(detail.outcome).toBe("ok");
    expect(detail.text).toContain("Weekly signups");
    expect(detail.text).not.toMatch(UUID);
  });

  it("answers the review inbox and the blocker board in words", async () => {
    const inbox = await read(createRefTable(), "review.inbox", {});
    expect(inbox.outcome).toBe("ok");
    expect(inbox.text).not.toMatch(UUID);

    const board = await read(createRefTable(), "blockers.board", {});
    expect(board.outcome).toBe("ok");
    expect(board.text).toBe("Nothing found.");
  });

  it("reads a key result's history and a goal's check-ins through refs", async () => {
    const goalId = await createGoal("Raise activation");
    const keyResultId = (
      (await call("goals.addKeyResult", {
        goalId,
        title: "Activation rate",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 10,
        targetValue: 50,
        weight: 1,
      })) as { id: string }
    ).id;
    const refs = createRefTable();
    await read(refs, "goals.list", {});
    const goalRef = refs
      .entries()
      .find((entry) => entry.entityId === goalId) as { ref: number };
    const krRef = refs
      .entries()
      .find((entry) => entry.entityId === keyResultId) as { ref: number };
    expect(krRef.ref).toBeGreaterThan(goalRef.ref);

    const history = await read(refs, "goals.keyResultHistory", {
      keyResultId: krRef.ref,
    });
    expect(history.outcome).toBe("ok");
    expect(history.text).not.toMatch(UUID);

    const checkIns = await read(refs, "goals.checkIns", {
      goalId: goalRef.ref,
    });
    expect(checkIns.outcome).toBe("ok");
    expect(checkIns.text).not.toMatch(UUID);
  });
});

describe("passages", () => {
  it("returns what retrieval found as numbered entities", async () => {
    const goalId = await createGoal("Improve onboarding for mid-market teams");
    const wb = await workerDb();
    await runEmbedJob(
      { workspaceId, entityType: "goal", entityId: goalId },
      {
        pool: wb.appPool,
        embed: async (inputs) => ({
          vectors: inputs.map(() => [0.1, 0.2, 0.3]),
          dimensions: 3,
          model: "test-embed",
        }),
      },
    );
    const refs = createRefTable();
    const found = await read(refs, "passages", { query: "onboarding" });
    expect(found.outcome).toBe("ok");
    expect(found.text).toContain("Improve onboarding for mid-market teams");
    expect(found.text).not.toMatch(UUID);
    expect(found.entities.map((e) => e.entityId)).toEqual([goalId]);

    // Two passages of one objective, then a cut: every number shown resolves.
    const keyResultId = (
      (await call("goals.addKeyResult", {
        goalId,
        title: "Onboarding completion rate",
        direction: "increase",
        indicatorType: "lagging",
        baselineValue: 1,
        targetValue: 2,
        weight: 1,
      })) as { id: string }
    ).id;
    await runEmbedJob(
      { workspaceId, entityType: "key_result", entityId: keyResultId },
      {
        pool: wb.appPool,
        embed: async (inputs) => ({
          vectors: inputs.map(() => [0.1, 0.2, 0.3]),
          dimensions: 3,
          model: "test-embed",
        }),
      },
    );
    const both = createRefTable();
    const twice = await read(both, "passages", { query: "onboarding" });
    for (const match of twice.text.matchAll(/^\[(\d+)\] /gm)) {
      expect(both.get(Number(match[1]))).toBeDefined();
    }
    expect(both.entries().length).toBe(twice.entities.length);

    const none = await read(createRefTable(), "passages", {
      query: "zzzzqqqq",
    });
    expect(none.text).toBe("Nothing found.");
  });
});
