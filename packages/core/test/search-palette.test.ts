import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { bindGroup, ensureMemberGroup } from "../src/access/contexts.ts";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { resolveSubjectContext } from "../src/access/reads.ts";
import { callAction } from "../src/actions/registry.ts";
import { EmbeddingService } from "../src/embeddings/service.ts";
import { runEmbedJob } from "../src/embeddings/worker.ts";
import { runOperation } from "../src/operations/operation.ts";
import {
  type SemanticSource,
  searchWithSemantic,
} from "../src/search/service.ts";
import { runIndexJob } from "../src/search/worker.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The command palette's reads (UIUX-PLAN §3 and §4 S-32, completeness review
 * M-21).
 *
 * **What was wrong.** The palette's jump found a KPI by its short code and
 * nothing else, a key result, a comment or a check-in in the results linked to
 * a page that was not theirs, and the semantic half of search was never asked.
 *
 * **The refusals here are real ones.** Every active person in a workspace holds
 * view on every goal through the workspace-wide group, so "a member who cannot
 * see the goal" is not a refusal this product has. A guest has no blanket
 * access at all, and holds only what it is given: a task it was let into,
 * here. A session is stricter than its space, and refuses a member who is not
 * in it. Those are the two refusals tested, in the jump by name, the jump by
 * code and the search results alike.
 */

const OWNER = "palette-owner";
const GUEST = "palette-guest";
const OUTSIDER = "palette-outsider";

let workspaceId: string;
let ownerMemberId: string;
let guestMemberId: string;
let spaceId: string;
let cycle: { id: string; name: string };
let goalId: string;
let keyResultId: string;
let kpiId: string;
let initiativeId: string;
let taskId: string;
let otherTaskId: string;
let documentId: string;
let sessionId: string;
let personId: string;

type Match = {
  entityType: string;
  entityId: string;
  title: string;
  href: string;
};

type Hit = Match & { snippet: string; semantic: boolean };

const call = async (name: string, input: unknown, userId = OWNER) => {
  const wb = await workerDb();
  return callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human" as const, userId },
    },
    name as never,
    input as never,
  );
};

const jump = async (text: string, userId = OWNER) =>
  (await call("search.entities", { text, limit: 20 }, userId)) as Match[];

const search = async (text: string, userId = OWNER) =>
  (await call("search.query", { text }, userId)) as Hit[];

/** Indexes one entity the way the relay would. */
const index = async (entityType: string, entityId: string) => {
  const wb = await workerDb();
  return runIndexJob(
    { workspaceId, entityType, entityId },
    { pool: wb.appPool },
  );
};

const richText = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** A deterministic stand-in for an embedding model. */
const embed = vi.fn(async (inputs: readonly string[]) => ({
  vectors: inputs.map(() => [0.1, 0.2, 0.3]),
  dimensions: 3,
  model: "test-embed",
}));

beforeEach(async () => {
  embed.mockClear();
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email)
     values ($1, 'Ada', $2), ($3, 'Gus', $4), ($5, 'Olu', $6)`,
    [
      OWNER,
      "palette-owner@example.com",
      GUEST,
      "palette-guest@example.com",
      OUTSIDER,
      "palette-outsider@example.com",
    ],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Ada",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  const space = (await call("spaces.create", { name: "Aurora squad" })) as {
    id: string;
  };
  spaceId = space.id;
  cycle = (await call("cycles.current", { mode: "quarterly" })) as {
    id: string;
    name: string;
  };

  goalId = (
    (await call("goals.create", {
      title: "Aurora launch lands with mid-market teams",
      cycleId: cycle.id,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    })) as { id: string }
  ).id;
  keyResultId = (
    (await call("goals.addKeyResult", {
      goalId,
      title: "Aurora activation from 41% to 60%",
      direction: "increase",
      indicatorType: "lagging",
      baselineValue: 41,
      targetValue: 60,
      weight: 1,
    })) as { id: string }
  ).id;
  kpiId = (
    (await call("kpis.create", {
      title: "Aurora weekly signups",
      frequency: "monthly",
      direction: "higher_better",
      indicatorType: "lagging",
      tier: "output",
      aggregate: "sum",
      ownerKind: "workspace",
    })) as { id: string }
  ).id;
  initiativeId = (
    (await call("initiatives.create", {
      spaceId,
      title: "Aurora onboarding rebuild",
      ownerId: ownerMemberId,
    })) as { id: string }
  ).id;
  taskId = (
    (await call("tasks.create", {
      spaceId,
      title: "Aurora pricing page copy",
    })) as { id: string }
  ).id;
  otherTaskId = (
    (await call("tasks.create", {
      spaceId,
      title: "Aurora billing migration",
    })) as { id: string }
  ).id;
  documentId = (
    (await call("documents.create", {
      subjectType: "goal",
      subjectId: goalId,
      title: "Aurora launch plan",
    })) as { id: string }
  ).id;
  await call("documents.publish", { id: documentId });
  sessionId = (
    (await call("sessions.create", {
      spaceId,
      kind: "weekly",
      title: "Aurora weekly check-in",
      scheduledFor: new Date().toISOString(),
      facilitatorId: ownerMemberId,
    })) as { id: string }
  ).id;

  const people = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status, kind)
     values (gen_random_uuid(), $1, $2, 'Gus Guest', 'active', 'guest'),
            (gen_random_uuid(), $1, $3, 'Olu Outsider', 'active', 'human'),
            (gen_random_uuid(), $1, null, 'Aurora Lin', 'active', 'placeholder')
     returning id, name`,
    [workspaceId, GUEST, OUTSIDER],
  );
  guestMemberId = people.rows[0]?.id as string;
  personId = people.rows[2]?.id as string;

  for (const [type, id] of [
    ["goal", goalId],
    ["key_result", keyResultId],
    ["kpi", kpiId],
    ["initiative", initiativeId],
    ["task", taskId],
    ["task", otherTaskId],
    ["document", documentId],
  ] as const) {
    await index(type, id);
  }
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the jump by name, which reaches every kind", () => {
  it("offers each kind the plan names, each linked to its own page", async () => {
    const found = await jump("aurora");
    const byType = new Map(found.map((one) => [one.entityType, one]));

    expect(byType.get("goal")?.href).toBe(`/goals/${goalId}`);
    // A key result opens its goal, at its own row.
    expect(byType.get("key_result")?.href).toBe(
      `/goals/${goalId}#kr-${keyResultId}`,
    );
    expect(byType.get("kpi")?.href).toBe(`/kpis/${kpiId}`);
    expect(byType.get("initiative")?.href).toBe(`/initiatives/${initiativeId}`);
    expect(byType.get("document")?.href).toBe(`/documents/${documentId}`);
    expect(byType.get("space")?.href).toBe(`/spaces/${spaceId}`);
    expect(byType.get("session")?.href).toBe(`/session/${sessionId}`);
    expect(byType.get("person")?.href).toBe(`/people/${personId}`);
    expect(
      found.filter((one) => one.entityType === "task").map((one) => one.href),
    ).toEqual(
      expect.arrayContaining([`/tasks/${taskId}`, `/tasks/${otherTaskId}`]),
    );
  });

  it("offers a cycle by its name", async () => {
    const found = await jump(cycle.name);
    expect(found.find((one) => one.entityType === "cycle")?.href).toBe(
      `/cycle?cycle=${cycle.id}`,
    );
  });

  it("finds the start of a word, which the phrase search cannot", async () => {
    // Full text wants whole words. A palette is typed into a letter at a time,
    // and "Auro" has to find Aurora before the last two letters arrive.
    expect(await search("Auro")).toEqual([]);
    expect((await jump("Auro")).length).toBeGreaterThan(0);
  });

  it("needs every word, in any order and any case", async () => {
    const found = await jump("PRICING aurora");
    expect(found.map((one) => one.entityId)).toEqual([taskId]);
  });

  it("puts a name that starts with the phrase ahead of one that only holds it", async () => {
    const long = (await call("tasks.create", {
      spaceId,
      title: "Launch checklist for the regional partner programme",
    })) as { id: string };
    await index("task", long.id);

    // "Aurora launch plan" is shorter and holds the word; the task starts
    // with it, which is what somebody typing "launch" most likely meant.
    const found = await jump("launch");
    expect(found[0]?.entityId).toBe(long.id);
    expect(found.map((one) => one.entityId)).toContain(documentId);
  });

  it("treats % and _ as characters, not wildcards", async () => {
    expect((await jump("41%")).map((one) => one.entityId)).toEqual([
      keyResultId,
    ]);
    // As a wildcard, "a_r" would match the "aur" at the start of every name.
    expect(await jump("a_r")).toEqual([]);
  });
});

describe("the jump offers nothing the reader could not open", () => {
  it("gives a guest the one task it was let into and nothing else of the work", async () => {
    // A guest cannot be assigned a task (an assignee is a person), so it is
    // let into this one through its own group, which is the one tier a guest
    // has at all. Through the pipeline, as `access-reads.test.ts` grants a
    // personal binding, so the grant is audited like any other.
    const wb = await workerDb();
    await runOperation(
      { pool: wb.appPool },
      {
        action: "test.grant-guest",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx }) {
          const context = await resolveSubjectContext(
            tx,
            "task",
            taskId,
            workspaceId,
          );
          const groupId = await ensureMemberGroup(tx, {
            workspaceId,
            memberId: guestMemberId,
          });
          await bindGroup(tx, {
            workspaceId,
            groupId,
            contextId: context?.contextId as string,
            level: ACCESS_LEVELS.view,
          });
          return {
            result: undefined,
            activity: {
              kind: "test.grant-guest",
              subjectType: "task",
              subjectId: taskId,
            },
            audit: { action: "test.grant-guest", targetType: "task" },
          };
        },
      },
    );

    const found = await jump("aurora", GUEST);
    const work = found.filter((one) => one.entityType !== "person");
    // The one task it holds, and not the task beside it, the goal, the key
    // result, the KPI, the space, the initiative, the document or the session.
    expect(work.map((one) => one.entityId)).toEqual([taskId]);
    // The directory is open to every member, and so is a person's page.
    expect(found.map((one) => one.entityId)).toContain(personId);
  });

  it("does not offer a session in a space the reader is not in", async () => {
    const found = await jump("aurora", OUTSIDER);
    const types = found.map((one) => one.entityType);
    // The space itself is readable by every member, so that it can be found
    // and joined. The session in it is a room the reader is not in.
    expect(types).toContain("space");
    expect(types).toContain("goal");
    expect(types).not.toContain("session");

    await call("spaces.addMember", {
      spaceId,
      memberId: (
        await (
          await workerDb()
        ).admin.query<{ id: string }>(
          "select id from workspace_members where user_id = $1",
          [OUTSIDER],
        )
      ).rows[0]?.id,
      role: "member",
    });
    expect(
      (await jump("aurora", OUTSIDER)).map((one) => one.entityType),
    ).toContain("session");
  });

  it("gives a guest nothing for a KPI's short code, as it gives nothing for its name", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ short_id: string }>(
      "select short_id from kpis where id = $1",
      [kpiId],
    );
    const code = rows[0]?.short_id as string;

    // The control: a person in the workspace reads every KPI, by code too.
    expect(await call("search.jump", { shortId: code })).toMatchObject({
      entityId: kpiId,
      href: `/kpis/${kpiId}`,
    });
    // A guest holds no blanket tier, so the jump by code agrees with the jump
    // by name beside it in the same list.
    expect(await call("search.jump", { shortId: code }, GUEST)).toBeNull();
    expect(
      (await jump("aurora weekly", GUEST)).map((one) => one.entityType),
    ).not.toContain("kpi");
  });

  it("refuses a suspended reader outright", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where user_id = $1",
      [OUTSIDER],
    );
    await expect(jump("aurora", OUTSIDER)).rejects.toThrow(/No such workspace/);
  });

  it("does not offer a suspended person", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [personId],
    );
    expect(
      (await jump("aurora lin")).filter((one) => one.entityType === "person"),
    ).toEqual([]);
  });
});

describe("where a search result opens", () => {
  it("links a key result to its goal, not to a goal with its own id", async () => {
    const [hit] = (await search("activation")).filter(
      (one) => one.entityType === "key_result",
    );
    expect(hit?.href).toBe(`/goals/${goalId}#kr-${keyResultId}`);
  });

  it("links a comment to the thing it was written on", async () => {
    const comment = (await call("comments.create", {
      subjectType: "task",
      subjectId: taskId,
      body: richText("Borealis wording needs a second pass."),
    })) as { id: string };
    await index("comment", comment.id);

    const [hit] = await search("Borealis");
    expect(hit?.entityType).toBe("comment");
    expect(hit?.href).toBe(`/tasks/${taskId}`);
  });

  it("leaves out a session for a reader who is not in its space", async () => {
    // The index lets a session through to anybody who can view its space,
    // which is every member. Its page wants the reader in the space, so a
    // result that would open onto a refusal is not offered.
    await index("session", sessionId);

    const forOwner = (await search("weekly")).filter(
      (one) => one.entityType === "session",
    );
    expect(forOwner.map((one) => one.href)).toEqual([`/session/${sessionId}`]);

    expect(
      (await search("weekly", OUTSIDER)).map((one) => one.entityType),
    ).not.toContain("session");
  });
});

describe("semantic search, which only an AI provider turns on", () => {
  /**
   * A goal that is in the embeddings index and not in the search index, so
   * the only way a search can return it is by asking the semantic half.
   */
  const embedOnly = async () => {
    const wb = await workerDb();
    const hidden = (await call("goals.create", {
      title: "Glacier retention for returning customers",
      cycleId: cycle.id,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    })) as { id: string };
    await runEmbedJob(
      { workspaceId, entityType: "goal", entityId: hidden.id },
      { pool: wb.appPool, embed },
    );
    embed.mockClear();
    return hidden.id;
  };

  /**
   * The real retrieval, over a database that says it has pgvector.
   *
   * The test database has no pgvector, so retrieval takes its full-text path
   * over the embeddings index, which is still the index the semantic half
   * reads and still filters every passage through the access getter.
   */
  const source = (): SemanticSource & { asked: number } => {
    const state = { asked: 0 };
    return {
      get asked() {
        return state.asked;
      },
      async hasPgvector() {
        return true;
      },
      async retrieve(input) {
        state.asked += 1;
        const wb = await workerDb();
        return new EmbeddingService(wb.appPool, embed).retrieve(input);
      },
    };
  };

  const memberOf = async (userId: string) => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ id: string }>(
      "select id from workspace_members where user_id = $1",
      [userId],
    );
    return rows[0]?.id as string;
  };

  it("is never asked with the provider off, and search still answers", async () => {
    const hidden = await embedOnly();
    const wb = await workerDb();
    const spy = source();

    const hits = await searchWithSemantic(
      wb.appPool,
      { workspaceId, memberId: ownerMemberId, text: "retention" },
      null,
      spy,
    );
    expect(spy.asked).toBe(0);
    expect(embed).not.toHaveBeenCalled();
    expect(hits.map((hit) => hit.entityId)).not.toContain(hidden);

    // Through the action, as the palette asks it with no provider: full text
    // answers, and the semantic-only goal is not there.
    expect((await search("aurora")).length).toBeGreaterThan(0);
    expect((await search("retention")).map((hit) => hit.entityId)).toEqual([]);
  });

  it("blends related results in when it is on, marked as such", async () => {
    const hidden = await embedOnly();
    const wb = await workerDb();
    const spy = source();

    const hits = await searchWithSemantic(
      wb.appPool,
      { workspaceId, memberId: ownerMemberId, text: "retention" },
      embed,
      spy,
    );
    expect(spy.asked).toBe(1);
    const related = hits.find((hit) => hit.entityId === hidden);
    expect(related?.semantic).toBe(true);
    expect(related?.title).toContain("Glacier retention");
  });

  it("filters related results by who is asking", async () => {
    const hidden = await embedOnly();
    const wb = await workerDb();

    const forGuest = await searchWithSemantic(
      wb.appPool,
      {
        workspaceId,
        memberId: await memberOf(GUEST),
        text: "retention",
      },
      embed,
      source(),
    );
    expect(forGuest.map((hit) => hit.entityId)).not.toContain(hidden);

    const forOutsider = await searchWithSemantic(
      wb.appPool,
      {
        workspaceId,
        memberId: await memberOf(OUTSIDER),
        text: "retention",
      },
      embed,
      source(),
    );
    // A person in the workspace reads every goal, so this is the control:
    // the passage is there, and only the guest was refused it.
    expect(forOutsider.map((hit) => hit.entityId)).toContain(hidden);
  });
});
