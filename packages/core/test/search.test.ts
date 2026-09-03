import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { runIndexJob } from "../src/search/worker.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * Search, the palette's jump and the export (TECHNICAL-PLAN §5, §9, P5-T13).
 *
 * The task's own test plan:
 *   - a term inside a private space's document returns nothing for a non-member
 *     and a highlighted result for a member
 *   - an export matches the visible rows and columns exactly
 *
 * **The first line needs a real refusal to test against, and this product has
 * one: suspension.** P3-T01's `workspace_standard` binding gives every active
 * member `edit` across the workspace, so "a member outside the space" is not a
 * refusal here and a test asserting it would pass for the wrong reason. That is
 * the same reasoning `embeddings-retrieval.test.ts` recorded at P4-T13b, and it
 * is why the private-space case is written as a suspended member.
 */

const OWNER = "search-owner";
const OTHER = "search-other";

let workspaceId: string;
let ownerMemberId: string;
let otherMemberId: string;
let spaceId: string;
let cycleId: string;
let goalId: string;

const PHRASE = "mid-market activation";

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

/** Indexes one entity the way the relay would: read the job, run the worker. */
const index = async (entityType: string, entityId: string) => {
  const wb = await workerDb();
  return runIndexJob(
    { workspaceId, entityType, entityId },
    { pool: wb.appPool },
  );
};

const search = async (text: string, userId = OWNER) =>
  (await call("search.query", { text }, userId)) as {
    entityType: string;
    entityId: string;
    title: string;
    snippet: string;
    href: string;
  }[];

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    `insert into users (id, name, email) values ($1, 'Ada', $2), ($3, 'Bo', $4)`,
    [OWNER, "search-owner@example.com", OTHER, "search-other@example.com"],
  );

  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Ada",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;

  const spaces = (await call("spaces.list", {})) as { id: string }[];
  spaceId = spaces[0]?.id as string;
  const cycle = (await call("cycles.current", { mode: "quarterly" })) as {
    id: string;
  };
  cycleId = cycle.id;

  const goal = (await call("goals.create", {
    title: `Raise ${PHRASE} to sixty per cent`,
    cycleId,
    spaceId,
    level: "team",
    ownerKind: "space",
    championId: ownerMemberId,
    reviewerId: ownerMemberId,
    weight: 1,
  })) as { id: string };
  goalId = goal.id;

  const member = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, user_id, name, status)
     values (gen_random_uuid(), $1, $2, 'Bo', 'active') returning id`,
    [workspaceId, OTHER],
  );
  otherMemberId = member.rows[0]?.id as string;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the index, which is written by the outbox and nothing else", () => {
  it("finds a goal once its row has been indexed, and not before", async () => {
    // The pipeline enqueues the row; nothing drains it in a test, which is the
    // same honest position the embedding worker has carried since P4-T13a.
    expect(await search(PHRASE)).toEqual([]);

    await index("goal", goalId);

    const hits = await search(PHRASE);
    expect(hits.map((hit) => hit.entityId)).toEqual([goalId]);
    expect(hits[0]?.entityType).toBe("goal");
    expect(hits[0]?.href).toBe(`/goals/${goalId}`);
  });

  it("marks the matching words, so a screen can show what matched", async () => {
    await index("goal", goalId);
    const [hit] = await search("activation");
    expect(hit?.snippet).toContain("<b>");
    expect(hit?.snippet.toLowerCase()).toContain("activation");
  });

  it("takes the row out when the thing it points at goes", async () => {
    await index("goal", goalId);
    await call("goals.delete", { id: goalId });
    const outcome = await index("goal", goalId);

    expect(outcome.kind).toBe("removed");
    expect(await search(PHRASE)).toEqual([]);
  });

  it("skips a type nothing indexes rather than failing the queue", async () => {
    const outcome = await index("invoice", goalId);
    expect(outcome).toEqual({
      kind: "skipped",
      reason: "nothing indexes a invoice",
    });
  });

  it("narrows to one entity type, which is what the page's tabs do", async () => {
    await index("goal", goalId);
    const goalsOnly = (await call("search.query", {
      text: PHRASE,
      entityTypes: ["goal"],
    })) as { entityId: string }[];
    expect(goalsOnly.map((hit) => hit.entityId)).toEqual([goalId]);

    const tasksOnly = (await call("search.query", {
      text: PHRASE,
      entityTypes: ["task"],
    })) as unknown[];
    expect(tasksOnly).toEqual([]);
  });

  it("answers nothing to a phrase nothing matches", async () => {
    await index("goal", goalId);
    expect(await search("submarine cartography")).toEqual([]);
  });
});

describe("who sees what, filtered in SQL", () => {
  it("answers a member who may read the goal", async () => {
    await index("goal", goalId);
    expect((await search(PHRASE, OTHER)).map((hit) => hit.entityId)).toEqual([
      goalId,
    ]);
  });

  it("test plan: gives a suspended member nothing, though the row is indexed", async () => {
    const wb = await workerDb();
    await index("goal", goalId);
    expect(await search(PHRASE, OTHER)).toHaveLength(1);

    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [otherMemberId],
    );

    // Refused rather than answered empty, which is what every read in this
    // product does for a suspended member: they are not somebody with no
    // results, they are somebody with no workspace.
    await expect(search(PHRASE, OTHER)).rejects.toThrow(/No such workspace/);
    // And the index is untouched: this is a read-time decision, not a reindex.
    const { rows } = await wb.admin.query<{ count: string }>(
      "select count(*) from search_documents where entity_id = $1",
      [goalId],
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it("never indexes an unpublished document at all", async () => {
    const wb = await workerDb();
    const draft = (await call("documents.create", {
      subjectType: "goal",
      subjectId: goalId,
      title: `A plan for ${PHRASE}`,
    })) as { id: string };

    const outcome = await index("document", draft.id);
    // The index has one context per row and no notion of an author, so a draft
    // in it would be findable by everybody who can read its subject. It is
    // indexed the moment it is published and not before.
    expect(outcome.kind).toBe("removed");
    const { rows } = await wb.admin.query<{ count: string }>(
      "select count(*) from search_documents where entity_id = $1",
      [draft.id],
    );
    expect(Number(rows[0]?.count)).toBe(0);

    await call("documents.publish", { id: draft.id });
    expect((await index("document", draft.id)).kind).toBe("indexed");
    expect((await search("plan", OTHER)).map((hit) => hit.entityId)).toContain(
      draft.id,
    );
  });
});

describe("the palette's jump", () => {
  it("opens a KPI by its short identifier", async () => {
    const kpi = (await call("kpis.create", {
      title: "Weekly activation rate",
      frequency: "monthly",
      direction: "higher_better",
      indicatorType: "lagging",
      tier: "output",
      aggregate: "sum",
      ownerKind: "workspace",
    })) as { id: string };

    const wb = await workerDb();
    const { rows } = await wb.admin.query<{ short_id: string }>(
      "select short_id from kpis where id = $1",
      [kpi.id],
    );
    const code = rows[0]?.short_id as string;

    const found = (await call("search.jump", { shortId: code })) as {
      entityType: string;
      entityId: string;
    } | null;
    expect(found?.entityType).toBe("kpi");
    expect(found?.entityId).toBe(kpi.id);
  });

  it("answers null for a code nothing carries", async () => {
    // Goals, initiatives and tasks have no short identifier yet, so the palette
    // falls back to the phrase search rather than pretending to a lookup.
    expect(await call("search.jump", { shortId: "NOPE-1" })).toBeNull();
  });
});

describe("the export, which is the one action that takes data out", () => {
  it("test plan: matches the rows and the columns the screen shows", async () => {
    const exported = (await call("exports.list", { list: "goals" })) as {
      csv: string | null;
      rowCount: number;
      queued: boolean;
    };
    expect(exported.queued).toBe(false);
    expect(exported.rowCount).toBe(1);

    const lines = (exported.csv ?? "").trim().split("\r\n");
    expect(lines[0]).toContain('"Objective"');
    expect(lines[0]).toContain('"Champion"');
    expect(lines[1]).toContain(PHRASE);
    // One header and one row, which is exactly what the explorer draws.
    expect(lines).toHaveLength(2);
  });

  it("writes an audit row, because an export leaves the product", async () => {
    const wb = await workerDb();
    await call("exports.list", { list: "goals" });

    const { rows } = await wb.admin.query<{ action: string }>(
      "select action from audit_events where workspace_id = $1 and action = 'exports.list'",
      [workspaceId],
    );
    expect(rows).toHaveLength(1);
  });

  it("carries no row its reader could not see on a screen", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where id = $1",
      [otherMemberId],
    );
    // A suspended member reaches nothing, and their export is empty rather than
    // a file full of rows the screen would not have shown them.
    await expect(
      call("exports.list", { list: "goals" }, OTHER),
    ).rejects.toThrow();
  });

  it("neutralises a title a spreadsheet would run as a formula", async () => {
    await call("goals.create", {
      title: "=cmd|'/c calc'!A1",
      cycleId,
      spaceId,
      level: "team",
      ownerKind: "space",
      championId: ownerMemberId,
      reviewerId: ownerMemberId,
      weight: 1,
    });

    const exported = (await call("exports.list", { list: "goals" })) as {
      csv: string | null;
    };
    // A leading `=` is prefixed with a single quote, which is the standard
    // mitigation. The values here are typed by people and one of them may not
    // be friendly.
    expect(exported.csv).toContain(`"'=cmd`);
  });
});
