import { randomUUID } from "node:crypto";
import { type WorkspaceTx, withWorkspace, workspaces } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  bindGroup,
  ensureContext,
  ensureMemberGroup,
} from "../src/access/contexts.ts";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { aggregateFeed, queryFeed } from "../src/activities/feed.ts";
import { renderActivity } from "../src/activities/renderers.ts";
import {
  ensureSubscriptionList,
  subscribeMember,
} from "../src/notifications/subscriptions.ts";
import { runOperation } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * The typed activity feed engine (P2-T07 test plan, TECHNICAL-PLAN §4.11,
 * screen S-31).
 *
 * An event kind outside the catalogue cannot be persisted, and the whole
 * operation rolls back with it. A member without access to a restricted
 * context sees no activity from it in the workspace feed, while a member
 * with access does. Aggregation collapses consecutive same-actor profile
 * edits into one row, but never a narrative event like a suspension. Feed
 * pagination is stable across pages.
 */

const OWNER = "activity-owner";

let workspaceId: string;
let ownerMemberId: string;

async function withReadTx<T>(fn: (tx: WorkspaceTx) => Promise<T>): Promise<T> {
  const wb = await workerDb();
  return withWorkspace(drizzle(wb.appPool), workspaceId, fn);
}

async function addMember(name: string): Promise<string> {
  const wb = await workerDb();
  const result = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, name, kind, status)
     values (gen_random_uuid(), $1, $2, 'human', 'active')
     returning id`,
    [workspaceId, name],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("insert into workspace_members returned no row");
  }
  return row.id;
}

/**
 * `resourceType` defaults to the untracked "test-aggregate" — safe for
 * plain feed-visibility, since `queryFeed` gates on this context's own
 * stored id directly and never re-resolves by type. The fan-out test below
 * passes "blob" instead, because *that* path goes through
 * `resolveRecipients`'s `getAccessScoped`, whose `SUBJECT_RESOLVERS` map
 * (access/reads.ts) is exhaustive and fail-closed — an unregistered type
 * raises there rather than resolving. "blob" would be the wrong default
 * here, though: `queryFeed`'s own liveness filter specifically checks a
 * `blob` subject against the real `blobs` table, and this helper never
 * creates one, so a "blob"-typed activity would be silently dropped as a
 * dangling reference rather than shown.
 */
async function makeRestrictedActivity(
  resourceId: string,
  grantedMemberId: string,
  resourceType = "test-aggregate",
): Promise<void> {
  const wb = await workerDb();
  await runOperation(
    { pool: wb.appPool },
    {
      action: "test.restricted-activity",
      workspaceId,
      actor: { kind: "human", userId: OWNER },
      async execute({ tx }) {
        const contextId = await ensureContext(tx, {
          workspaceId,
          resourceType,
          resourceId,
        });
        const groupId = await ensureMemberGroup(tx, {
          workspaceId,
          memberId: grantedMemberId,
        });
        await bindGroup(tx, {
          workspaceId,
          groupId,
          contextId,
          level: ACCESS_LEVELS.view,
        });
        return {
          result: undefined,
          activity: {
            kind: "test.restricted-note",
            subjectType: resourceType,
            subjectId: resourceId,
            contextId,
          },
          audit: {
            action: "test.restricted-activity",
            targetType: resourceType,
          },
        };
      },
    },
  );
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Activity Owner", "activity-owner@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Activity Owner",
  });
  workspaceId = provisioned.workspaceId;
  ownerMemberId = provisioned.memberId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("an event kind outside the catalogue cannot be persisted", () => {
  it("rejects the whole operation, leaving no activity or audit row behind", async () => {
    const wb = await workerDb();
    const before = await wb.admin.query(
      "select (select count(*) from activities) as a, (select count(*) from audit_events) as b",
    );

    await expect(
      runOperation(
        { pool: wb.appPool },
        {
          action: "test.unregistered-kind",
          workspaceId,
          actor: { kind: "human", userId: OWNER },
          async execute() {
            return {
              result: undefined,
              activity: {
                kind: "not.a.real.kind",
                subjectType: "workspace",
                subjectId: workspaceId,
              },
              audit: {
                action: "test.unregistered-kind",
                targetType: "workspace",
              },
            };
          },
        },
      ),
    ).rejects.toThrow(/not in the activity catalogue/i);

    const after = await wb.admin.query(
      "select (select count(*) from activities) as a, (select count(*) from audit_events) as b",
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("rejects a registered kind given a payload that does not match its schema", async () => {
    const wb = await workerDb();
    await expect(
      runOperation(
        { pool: wb.appPool },
        {
          action: "test.bad-payload",
          workspaceId,
          actor: { kind: "human", userId: OWNER },
          async execute() {
            return {
              result: undefined,
              activity: {
                kind: "workspace.renamed",
                subjectType: "workspace",
                subjectId: workspaceId,
                payload: { onlyFrom: "not the right shape" },
              },
              audit: { action: "test.bad-payload", targetType: "workspace" },
            };
          },
        },
      ),
    ).rejects.toThrow(/invalid payload/i);
  });

  it("still allows a test.* scaffold kind through, unvalidated", async () => {
    const wb = await workerDb();
    await expect(
      runOperation(
        { pool: wb.appPool },
        {
          action: "test.scaffold-kind",
          workspaceId,
          actor: { kind: "human", userId: OWNER },
          async execute() {
            return {
              result: undefined,
              activity: {
                kind: "test.anything-at-all",
                subjectType: "workspace",
                subjectId: workspaceId,
              },
              audit: { action: "test.scaffold-kind", targetType: "workspace" },
            };
          },
        },
      ),
    ).resolves.toBeUndefined();
  });
});

describe("access-scoped feed visibility", () => {
  it("hides a restricted-context activity from a member without access, and shows it to one with", async () => {
    const withAccess = await addMember("With Access");
    const withoutAccess = await addMember("Without Access");
    await makeRestrictedActivity(randomUUID(), withAccess);

    const visibleTo = await withReadTx((tx) =>
      queryFeed(tx, { workspaceId, memberId: withAccess }),
    );
    const hiddenFrom = await withReadTx((tx) =>
      queryFeed(tx, { workspaceId, memberId: withoutAccess }),
    );

    expect(visibleTo.some((item) => item.kind === "test.restricted-note")).toBe(
      true,
    );
    expect(
      hiddenFrom.some((item) => item.kind === "test.restricted-note"),
    ).toBe(false);
  });

  it("keeps a workspace-level activity (no context) visible to every active member", async () => {
    const wb = await workerDb();
    const bystander = await addMember("Bystander");
    await runOperation(
      { pool: wb.appPool },
      {
        action: "workspace.rename",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx, workspaceId: wid }) {
          await tx
            .update(workspaces)
            .set({ name: "Renamed" })
            .where(eq(workspaces.id, wid));
          return {
            result: undefined,
            activity: {
              kind: "workspace.renamed",
              subjectType: "workspace",
              subjectId: wid,
              payload: { from: "Old", to: "Renamed" },
            },
            audit: { action: "workspace.rename", targetType: "workspace" },
          };
        },
      },
    );

    const feed = await withReadTx((tx) =>
      queryFeed(tx, { workspaceId, memberId: bystander }),
    );
    expect(feed.some((item) => item.kind === "workspace.renamed")).toBe(true);
  });
});

describe("aggregation", () => {
  it("collapses five consecutive profile edits by the same actor into one row", async () => {
    const wb = await workerDb();
    for (let i = 0; i < 5; i++) {
      await runOperation(
        { pool: wb.appPool },
        {
          action: "test.profile-edit",
          workspaceId,
          actor: { kind: "human", userId: OWNER },
          async execute() {
            return {
              result: undefined,
              activity: {
                kind: "member.profile_updated",
                subjectType: "workspace_member",
                subjectId: ownerMemberId,
                payload: { name: "Activity Owner" },
              },
              audit: {
                action: "test.profile-edit",
                targetType: "workspace_member",
              },
            };
          },
        },
      );
    }

    const items = await withReadTx((tx) =>
      queryFeed(tx, { workspaceId, memberId: ownerMemberId }),
    );
    const aggregated = aggregateFeed(
      items,
      new Set(["member.profile_updated"]),
    );
    const editRows = aggregated.filter(
      (item) => item.kind === "member.profile_updated",
    );
    expect(editRows).toHaveLength(1);
    expect(editRows[0]?.aggregatedCount).toBe(5);
  });

  it("never collapses a narrative kind, even repeated back to back", async () => {
    const wb = await workerDb();
    const member = await addMember("Flappy");
    for (let i = 0; i < 2; i++) {
      await runOperation(
        { pool: wb.appPool },
        {
          action: "test.suspend-toggle",
          workspaceId,
          actor: { kind: "human", userId: OWNER },
          async execute() {
            return {
              result: undefined,
              activity: {
                kind: "member.suspended",
                subjectType: "workspace_member",
                subjectId: member,
                payload: { name: "Flappy" },
              },
              audit: {
                action: "test.suspend-toggle",
                targetType: "workspace_member",
              },
            };
          },
        },
      );
    }

    const items = await withReadTx((tx) =>
      queryFeed(tx, { workspaceId, memberId: ownerMemberId }),
    );
    // member.suspended is deliberately absent from AGGREGATABLE_KINDS.
    const aggregated = aggregateFeed(
      items,
      new Set(["member.profile_updated"]),
    );
    const suspendRows = aggregated.filter(
      (item) => item.kind === "member.suspended",
    );
    expect(suspendRows).toHaveLength(2);
    expect(suspendRows.every((row) => row.aggregatedCount === 1)).toBe(true);
  });
});

describe("rendering", () => {
  it("renders a registered kind's payload into a readable sentence", () => {
    expect(renderActivity("member.suspended", { name: "Jane Doe" })).toBe(
      "Jane Doe was suspended",
    );
  });
});

describe("notification fan-out driven from activities", () => {
  it("notifies a subscriber when an operation opts its activity into fan-out", async () => {
    const wb = await workerDb();
    const subscriber = await addMember("Subscriber");
    const fanoutDoc = randomUUID();
    await makeRestrictedActivity(fanoutDoc, subscriber, "blob");

    await runOperation(
      { pool: wb.appPool },
      {
        action: "test.subscribe-and-notify",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx }) {
          const listId = await ensureSubscriptionList(tx, {
            workspaceId,
            subjectType: "blob",
            subjectId: fanoutDoc,
          });
          await subscribeMember(tx, {
            workspaceId,
            listId,
            memberId: subscriber,
            reason: "joined",
          });
          return {
            result: undefined,
            activity: {
              kind: "test.fanout-trigger",
              subjectType: "blob",
              subjectId: fanoutDoc,
              notify: true,
            },
            audit: {
              action: "test.subscribe-and-notify",
              targetType: "blob",
            },
          };
        },
      },
    );

    const rows = await wb.admin.query(
      "select count(*)::int as n from notifications where recipient_member_id = $1",
      [subscriber],
    );
    expect(rows.rows[0].n).toBe(1);
  });
});

describe("feed pagination", () => {
  it("does not repeat or skip items across two cursor-based pages", async () => {
    const wb = await workerDb();
    for (let i = 0; i < 5; i++) {
      await runOperation(
        { pool: wb.appPool },
        {
          action: "test.paginate",
          workspaceId,
          actor: { kind: "human", userId: OWNER },
          async execute() {
            return {
              result: undefined,
              activity: {
                kind: "member.updated",
                subjectType: "workspace_member",
                subjectId: ownerMemberId,
                payload: { name: `Update ${i}` },
              },
              audit: {
                action: "test.paginate",
                targetType: "workspace_member",
              },
            };
          },
        },
      );
    }

    const firstPage = await withReadTx((tx) =>
      queryFeed(tx, { workspaceId, memberId: ownerMemberId, limit: 2 }),
    );
    expect(firstPage).toHaveLength(2);
    const last = firstPage[firstPage.length - 1];
    if (!last) {
      throw new Error("expected a first page");
    }
    const secondPage = await withReadTx((tx) =>
      queryFeed(tx, {
        workspaceId,
        memberId: ownerMemberId,
        limit: 2,
        cursor: { at: last.at, id: last.id },
      }),
    );

    const firstIds = new Set(firstPage.map((item) => item.id));
    expect(secondPage.some((item) => firstIds.has(item.id))).toBe(false);
  });
});
