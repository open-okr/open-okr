import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { ACTION_MAP, callAction } from "../src/actions/registry.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * A read action's declared level is enforced (P6-G31).
 *
 * **`access` recorded a requirement and nothing checked it.** Not
 * `defineReadAction`, not `callAction`, not the REST, agent or chat transports,
 * which take it only as the name of a scope. Twenty-nine reads declared above
 * `view` and two enforced it by hand, so over REST an ordinary member's token
 * reached the AI budgets, the channel message log, every agent run, the nudge
 * volume and the import history. In the browser the admin layout refuses first,
 * which is why the screens looked right while the surface underneath did not.
 *
 * Found while writing `invitations.list` at P6-G06a, which enforced its own and
 * so was one of the two.
 *
 * **This test enumerates the registry rather than a list.** A fixed list is a
 * list somebody forgets to extend, and the whole defect was a declaration
 * nobody read back. A read added next month with `access: full` and no
 * enforcement fails here without anybody remembering this file exists.
 *
 * **Two tiers, because a workspace has two.** Provisioning binds the
 * `workspace_standard` group at `edit` on the workspace's own context, so every
 * active member holds `edit` there, and the founding member's own group is
 * bound at `full` on top of it. So `edit` is what an ordinary member is, and
 * the line that matters runs between `edit` and `full`: the admin reads above
 * it must refuse them, and the eight at `comment` and `edit` must not.
 */

const OWNER = "read-access-owner";
const PLAIN = "read-access-plain";

let workspaceId: string;

/** Every read that asks for more than a member gets by being a member. */
function guardedReads(): readonly { name: string; access: number }[] {
  return Object.entries(ACTION_MAP)
    .filter(([, action]) => action.safety === "read")
    .filter(([, action]) => action.access > ACCESS_LEVELS.view)
    .map(([name, action]) => ({ name, access: action.access }));
}

/** The admin half: above the `edit` an ordinary member already holds. */
function adminReads(): readonly { name: string; access: number }[] {
  return guardedReads().filter((read) => read.access > ACCESS_LEVELS.edit);
}

/** The other half, which an ordinary member is entitled to reach. */
function ordinaryReads(): readonly { name: string; access: number }[] {
  return guardedReads().filter((read) => read.access <= ACCESS_LEVELS.edit);
}

/**
 * An input the schema accepts, built from the declared shape.
 *
 * The refusal has to happen before the handler runs, so the input only needs to
 * parse. A uuid field gets a real uuid rather than a string, because the schema
 * would refuse that first and the test would pass for the wrong reason.
 */
function plausibleInput(name: string): Record<string, unknown> {
  const uuid = "00000000-0000-4000-8000-000000000000";
  const byName: Record<string, Record<string, unknown>> = {
    "agents.readRun": { id: uuid },
    "ai.readPrompt": { promptKey: "coach.rewrite" },
    "ai.readUsageSummary": { since: new Date(0).toISOString() },
    "goals.draftObjective": {
      ambition: "Make onboarding the reason people stay",
      cycleId: uuid,
      level: "company",
    },
    "goals.rewriteKeyResult": { keyResultId: uuid, ruleId: "KR-3" },
    "goals.suggestMeasure": { goalId: uuid, title: "Raise activation" },
    "goals.suggestParent": { goalId: uuid },
    "goals.draftRetrospective": { goalId: uuid },
    "imports.proposeMapping": { entity: "goals", headers: ["title"] },
    "kpis.suggest": { description: "activation rate" },
    "sessions.managementRetro": { sessionId: uuid },
  };
  return byName[name] ?? {};
}

/**
 * The refusal `requireWorkspaceLevel` raises, word for word.
 *
 * The message deliberately names neither the action nor the level, so that a
 * stranger, a suspended member and a member below the level are told the same
 * thing. Matching the whole string rather than a fragment is what keeps this
 * from also matching `getAccessScoped`'s refusals for other resource types,
 * which are worded "No such goal", "No such space" and so on.
 */
const LEVEL_REFUSAL = "No such workspace, or you do not have access to it.";

/**
 * Runs the read and reports only whether the level check was what stopped it.
 *
 * Every other failure is the read's own business and has to be ignored here: an
 * AI assist with no provider configured, a run id that does not exist, a
 * channel never connected. What this file asserts is the check, not the reads.
 */
async function refusedByLevel(
  pool: Parameters<typeof callAction>[0]["pool"],
  actor: { kind: "human" | "system"; userId?: string },
  name: string,
): Promise<boolean> {
  try {
    await callAction(
      { pool, workspaceId, actor },
      name as never,
      plausibleInput(name) as never,
    );
    return false;
  } catch (error) {
    return (error as Error).message === LEVEL_REFUSAL;
  }
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3), ($4, $5, $6)",
    [
      OWNER,
      "Owner",
      "read-access-owner@example.com",
      PLAIN,
      "Plain",
      "read-access-plain@example.com",
    ],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Owner",
  });
  workspaceId = provisioned.workspaceId;

  // A second, ordinary member. Nothing raises them above the `edit` that
  // `workspace_standard` gives every active member, and that is the principal
  // the defect handed the AI budgets to.
  await wb.admin.query(
    "insert into workspace_members (id, workspace_id, user_id, name, status)" +
      " values (gen_random_uuid(), $1, $2, 'Plain', 'active')",
    [workspaceId, PLAIN],
  );
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a read that declares more than view", () => {
  it("exists in quantity, so this test is worth having", () => {
    // If the registry ever holds none of these, the enforcement below is
    // untested rather than unnecessary, and the counts say which half.
    expect(guardedReads().length).toBeGreaterThan(20);
    expect(adminReads().length).toBeGreaterThan(15);
    expect(ordinaryReads().length).toBeGreaterThan(0);
  });

  it("refuses the way a read refuses, not the way a write does", async () => {
    // The first version of this check raised `forbidden` and named the action
    // and the level. Two existing specs caught it, and both were right: a read
    // refuses like the access getter, so that a stranger with no member row,
    // a suspended member and a member below the level cannot tell each other's
    // answer apart. Naming the action in the message would undo that on its
    // own, which is why the wording carries neither.
    const wb = await workerDb();
    await expect(
      callAction(
        {
          pool: wb.appPool,
          workspaceId,
          actor: { kind: "human", userId: PLAIN },
        },
        "ai.readBudgets",
        {},
      ),
    ).rejects.toMatchObject({ code: "not_found", message: LEVEL_REFUSAL });
  });

  it("refuses the admin half to an ordinary member", async () => {
    const wb = await workerDb();
    const answered: string[] = [];

    for (const read of adminReads()) {
      const refused = await refusedByLevel(
        wb.appPool,
        { kind: "human", userId: PLAIN },
        read.name,
      );
      if (!refused) {
        answered.push(`${read.name} (needs ${read.access})`);
      }
    }

    expect(answered).toEqual([]);
  });

  it("still lets that member reach what edit entitles them to", async () => {
    // The half that catches an over-strict check. A check that resolved the
    // wrong context, or compared the wrong way round, would refuse these too
    // and take eight working features out with it.
    const wb = await workerDb();
    const refused: string[] = [];

    for (const read of ordinaryReads()) {
      const stopped = await refusedByLevel(
        wb.appPool,
        { kind: "human", userId: PLAIN },
        read.name,
      );
      if (stopped) {
        refused.push(read.name);
      }
    }

    expect(refused).toEqual([]);
  });

  it("answers the founding member, who holds full", async () => {
    const wb = await workerDb();
    const refused: string[] = [];

    for (const read of guardedReads()) {
      const stopped = await refusedByLevel(
        wb.appPool,
        { kind: "human", userId: OWNER },
        read.name,
      );
      if (stopped) {
        refused.push(read.name);
      }
    }

    expect(refused).toEqual([]);
  });

  it("lets a system actor through, the way runOperation does", async () => {
    // A clock has no member to resolve. The scheduler host reads as `system`
    // and would otherwise be refused by its own product.
    //
    // `agents.list` rather than `settings.readWorkspaceSettings`, which opens
    // its transaction with `withContext` and so needs a user id of its own
    // whatever the level check decides. That is the action's constraint, not
    // this one's, and both declare `full`.
    const wb = await workerDb();
    await expect(
      callAction(
        { pool: wb.appPool, workspaceId, actor: { kind: "system" } },
        "agents.list",
        {},
      ),
    ).resolves.toBeDefined();
  });
});
