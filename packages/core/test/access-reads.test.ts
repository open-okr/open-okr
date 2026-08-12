import { randomUUID } from "node:crypto";
import {
  accessGroups,
  activeOnly,
  type WorkspaceTx,
  withWorkspace,
} from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { accessProbes } from "@openokr/test-support/db-fixtures";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  bindGroup,
  ensureContext,
  ensureMemberGroup,
  ensureWorkspaceStandardGroup,
} from "../src/access/contexts.ts";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import {
  accessScopeFilter,
  can,
  getAccessScoped,
  resolveAnonymousAccessLevel,
  resolveMemberAccessLevel,
  resolveSubjectContext,
} from "../src/access/reads.ts";
import { OperationError, runOperation } from "../src/operations/operation.ts";
import { provisionWorkspaceForUser } from "../src/workspaces/provisioning.ts";

/**
 * `can()` and the access-aware getter (P2-T02 test plan, TECHNICAL-PLAN
 * §4.1, §8.1 layer 2).
 *
 * One enforcement point: a permission matrix across every principal kind and
 * every level, with overlapping grants proving maximum wins; suspension
 * zeroing every read; not-found rather than forbidden, so there is no
 * existence oracle; an unknown subject type raising rather than defaulting;
 * and the composable list filter proving it works the same way for many rows
 * at once.
 *
 * Every read function below takes a transaction, because that is what an
 * Operation and an action handler always have on hand. `withReadTx` opens
 * one outside either, the way a plain assertion after the fact needs to.
 */

const OWNER = "access-reads-owner";

let workspaceId: string;

/** Opens a transaction scoped to the test workspace, for standalone reads. */
async function withReadTx<T>(fn: (tx: WorkspaceTx) => Promise<T>): Promise<T> {
  const wb = await workerDb();
  return withWorkspace(drizzle(wb.appPool), workspaceId, fn);
}

/** Adds a member row directly, bypassing invitations (which are P2-T04). */
async function addMember(kind: "human" | "guest" | "agent"): Promise<string> {
  const wb = await workerDb();
  const result = await wb.admin.query<{ id: string }>(
    `insert into workspace_members (id, workspace_id, name, kind, status)
     values (gen_random_uuid(), $1, $2, $3, 'active')
     returning id`,
    [workspaceId, `${kind}-member`, kind],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("insert into workspace_members returned no row");
  }
  return row.id;
}

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3)",
    [OWNER, "Access Reads Owner", "access-reads@example.com"],
  );
  const provisioned = await provisionWorkspaceForUser(wb.appPool, {
    id: OWNER,
    name: "Access Reads Owner",
  });
  workspaceId = provisioned.workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

/**
 * Creates a fresh context, isolated from the workspace's own.
 *
 * `label` is for readability at the call site only. `access_contexts.
 * resource_id` is a real `uuid` column — a plain string like "matrix-2"
 * fails the same way any other malformed uuid does, caught only once a real
 * Postgres actually ran this file rather than every prior, database-less
 * pass.
 */
async function makeContext(label: string): Promise<string> {
  const wb = await workerDb();
  return runOperation(
    { pool: wb.appPool },
    {
      action: "test.make-context",
      workspaceId,
      actor: { kind: "human", userId: OWNER },
      async execute({ tx }) {
        // `activities.subject_id` is also a real uuid column, so the same
        // generated value serves both — `label` never reaches storage, only
        // this function's own log line if it ever needs one.
        const resourceId = randomUUID();
        const contextId = await ensureContext(tx, {
          workspaceId,
          resourceType: "test-aggregate",
          resourceId,
        });
        return {
          result: contextId,
          activity: {
            kind: "test.make-context",
            subjectType: "test-aggregate",
            subjectId: resourceId,
          },
          audit: {
            action: "test.make-context",
            targetType: "test-aggregate",
            payload: { label },
          },
        };
      },
    },
  );
}

describe("the permission matrix: maximum wins across every principal kind", () => {
  it("a member with only a workspace_standard binding gets exactly that level", async () => {
    const memberId = await addMember("human");
    const contextId = await makeContext("matrix-1");

    const wb = await workerDb();
    await runOperation(
      { pool: wb.appPool },
      {
        action: "test.bind",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx }) {
          const groupId = await ensureWorkspaceStandardGroup(tx, {
            workspaceId,
          });
          await bindGroup(tx, {
            workspaceId,
            groupId,
            contextId,
            level: ACCESS_LEVELS.comment,
          });
          return {
            result: undefined,
            activity: {
              kind: "test.bind",
              subjectType: "test-aggregate",
              subjectId: contextId,
            },
            audit: { action: "test.bind", targetType: "test-aggregate" },
          };
        },
      },
    );

    const level = await withReadTx((tx) =>
      resolveMemberAccessLevel(tx, { workspaceId, memberId, contextId }),
    );
    expect(level).toBe(ACCESS_LEVELS.comment);
  });

  it("a personal binding and a wider tier combine to the maximum, not the sum", async () => {
    const memberId = await addMember("human");
    const contextId = await makeContext("matrix-2");

    const wb = await workerDb();
    await runOperation(
      { pool: wb.appPool },
      {
        action: "test.bind",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx }) {
          const standardGroupId = await ensureWorkspaceStandardGroup(tx, {
            workspaceId,
          });
          await bindGroup(tx, {
            workspaceId,
            groupId: standardGroupId,
            contextId,
            level: ACCESS_LEVELS.view,
          });
          const memberGroupId = await ensureMemberGroup(tx, {
            workspaceId,
            memberId,
          });
          await bindGroup(tx, {
            workspaceId,
            groupId: memberGroupId,
            contextId,
            level: ACCESS_LEVELS.full,
            tag: "champion",
          });
          return {
            result: undefined,
            activity: {
              kind: "test.bind",
              subjectType: "test-aggregate",
              subjectId: contextId,
            },
            audit: { action: "test.bind", targetType: "test-aggregate" },
          };
        },
      },
    );

    const level = await withReadTx((tx) =>
      resolveMemberAccessLevel(tx, { workspaceId, memberId, contextId }),
    );
    expect(level).toBe(ACCESS_LEVELS.full);
    expect(
      await withReadTx((tx) =>
        can(tx, { workspaceId, memberId, contextId }, ACCESS_LEVELS.full),
      ),
    ).toBe(true);
  });

  it("a space_standard binding reaches a member enrolled in that group, and no one else", async () => {
    const enrolled = await addMember("human");
    const outsider = await addMember("human");
    const contextId = await makeContext("matrix-3");
    const spaceId = "00000000-0000-4000-8000-000000000002";

    const wb = await workerDb();
    await runOperation(
      { pool: wb.appPool },
      {
        action: "test.bind-space",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx }) {
          // openokr:allow-mutation: test setup for a space-tier group, its
          // enrolment and its binding, all on the transaction this operation
          // opened. Spaces themselves are P3-T01; there is no member-facing
          // helper for either write because nothing creates a space_standard
          // group yet outside a test.
          const [spaceGroup] = await tx
            .insert(accessGroups)
            .values({ workspaceId, kind: "space_standard", spaceId })
            .returning({ id: accessGroups.id });
          const groupId = (spaceGroup as { id: string }).id;
          await tx.execute(sql`
            insert into access_group_memberships (id, workspace_id, group_id, member_id)
            values (gen_random_uuid(), ${workspaceId}, ${groupId}, ${enrolled})
          `);
          await bindGroup(tx, {
            workspaceId,
            groupId,
            contextId,
            level: ACCESS_LEVELS.edit,
          });
          return {
            result: undefined,
            activity: {
              kind: "test.bind-space",
              subjectType: "test-aggregate",
              subjectId: contextId,
            },
            audit: { action: "test.bind-space", targetType: "test-aggregate" },
          };
        },
      },
    );

    const enrolledLevel = await withReadTx((tx) =>
      resolveMemberAccessLevel(tx, {
        workspaceId,
        memberId: enrolled,
        contextId,
      }),
    );
    const outsiderLevel = await withReadTx((tx) =>
      resolveMemberAccessLevel(tx, {
        workspaceId,
        memberId: outsider,
        contextId,
      }),
    );
    expect(enrolledLevel).toBe(ACCESS_LEVELS.edit);
    expect(outsiderLevel).toBe(0);
  });

  it("resolves an agent-kind member exactly like a human member", async () => {
    const agentId = await addMember("agent");
    const contextId = await makeContext("matrix-4");

    const wb = await workerDb();
    await runOperation(
      { pool: wb.appPool },
      {
        action: "test.bind",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx }) {
          const groupId = await ensureMemberGroup(tx, {
            workspaceId,
            memberId: agentId,
          });
          await bindGroup(tx, {
            workspaceId,
            groupId,
            contextId,
            level: ACCESS_LEVELS.edit,
          });
          return {
            result: undefined,
            activity: {
              kind: "test.bind",
              subjectType: "test-aggregate",
              subjectId: contextId,
            },
            audit: { action: "test.bind", targetType: "test-aggregate" },
          };
        },
      },
    );

    const level = await withReadTx((tx) =>
      resolveMemberAccessLevel(tx, {
        workspaceId,
        memberId: agentId,
        contextId,
      }),
    );
    expect(level).toBe(ACCESS_LEVELS.edit);
  });

  it("never reaches a guest-kind member through workspace_standard, only a personal binding does", async () => {
    const guestId = await addMember("guest");
    const contextId = await makeContext("matrix-5");

    const wb = await workerDb();
    await runOperation(
      { pool: wb.appPool },
      {
        action: "test.bind",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx }) {
          const groupId = await ensureWorkspaceStandardGroup(tx, {
            workspaceId,
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
              kind: "test.bind",
              subjectType: "test-aggregate",
              subjectId: contextId,
            },
            audit: { action: "test.bind", targetType: "test-aggregate" },
          };
        },
      },
    );

    // Confirmed by the human (2026-08-10), closing the open question P2-T02
    // originally recorded here: a guest (and an agent, and a placeholder)
    // reaches nothing through the blanket workspace_standard/space_standard
    // tiers, ever — only a personal (`member`-kind) binding names them
    // anything. Safer for an external guest, and matches AI-NATIVE-PLAN
    // §1.3's "no service account with ambient authority" for an agent.
    const level = await withReadTx((tx) =>
      resolveMemberAccessLevel(tx, {
        workspaceId,
        memberId: guestId,
        contextId,
      }),
    );
    expect(level).toBe(0);

    // A personal binding still reaches them, because it names them directly
    // rather than through either blanket tier.
    await runOperation(
      { pool: wb.appPool },
      {
        action: "test.grant-personal",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx }) {
          const memberGroupId = await ensureMemberGroup(tx, {
            workspaceId,
            memberId: guestId,
          });
          await bindGroup(tx, {
            workspaceId,
            groupId: memberGroupId,
            contextId,
            level: ACCESS_LEVELS.comment,
          });
          return {
            result: undefined,
            activity: {
              kind: "test.grant-personal",
              subjectType: "test-aggregate",
              subjectId: contextId,
            },
            audit: {
              action: "test.grant-personal",
              targetType: "test-aggregate",
            },
          };
        },
      },
    );

    const personalLevel = await withReadTx((tx) =>
      resolveMemberAccessLevel(tx, {
        workspaceId,
        memberId: guestId,
        contextId,
      }),
    );
    expect(personalLevel).toBe(ACCESS_LEVELS.comment);
  });

  it("resolves the anonymous principal from the anonymous group alone, unaffected by member bindings", async () => {
    const memberId = await addMember("human");
    const contextId = await makeContext("matrix-6");

    const wb = await workerDb();
    await runOperation(
      { pool: wb.appPool },
      {
        action: "test.bind-anonymous",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx }) {
          const memberGroupId = await ensureMemberGroup(tx, {
            workspaceId,
            memberId,
          });
          await bindGroup(tx, {
            workspaceId,
            groupId: memberGroupId,
            contextId,
            level: ACCESS_LEVELS.full,
          });
          // openokr:allow-mutation: the anonymous group and its binding, on
          // the transaction this operation opened. There is no member-facing
          // helper for the anonymous group because no member ever holds it.
          const [anonGroup] = await tx
            .insert(accessGroups)
            .values({ workspaceId, kind: "anonymous" })
            .returning({ id: accessGroups.id });
          await bindGroup(tx, {
            workspaceId,
            groupId: (anonGroup as { id: string }).id,
            contextId,
            level: ACCESS_LEVELS.view,
          });
          return {
            result: undefined,
            activity: {
              kind: "test.bind-anonymous",
              subjectType: "test-aggregate",
              subjectId: contextId,
            },
            audit: {
              action: "test.bind-anonymous",
              targetType: "test-aggregate",
            },
          };
        },
      },
    );

    const anonymousLevel = await withReadTx((tx) =>
      resolveAnonymousAccessLevel(tx, { workspaceId, contextId }),
    );
    expect(anonymousLevel).toBe(ACCESS_LEVELS.view);

    // The member's own full binding never leaks into the anonymous answer.
    const memberLevel = await withReadTx((tx) =>
      resolveMemberAccessLevel(tx, { workspaceId, memberId, contextId }),
    );
    expect(memberLevel).toBe(ACCESS_LEVELS.full);
  });
});

describe("suspension zeroes every read", () => {
  it("a suspended member loses a binding that would otherwise resolve to full", async () => {
    const memberId = await addMember("human");
    const contextId = await makeContext("suspend-1");

    const wb = await workerDb();
    await runOperation(
      { pool: wb.appPool },
      {
        action: "test.bind",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx }) {
          const groupId = await ensureMemberGroup(tx, {
            workspaceId,
            memberId,
          });
          await bindGroup(tx, {
            workspaceId,
            groupId,
            contextId,
            level: ACCESS_LEVELS.full,
            tag: "champion",
          });
          return {
            result: undefined,
            activity: {
              kind: "test.bind",
              subjectType: "test-aggregate",
              subjectId: contextId,
            },
            audit: { action: "test.bind", targetType: "test-aggregate" },
          };
        },
      },
    );

    const before = await withReadTx((tx) =>
      resolveMemberAccessLevel(tx, { workspaceId, memberId, contextId }),
    );
    expect(before).toBe(ACCESS_LEVELS.full);

    await wb.admin.query(
      "update workspace_members set status = 'suspended', suspended_at = now() where id = $1",
      [memberId],
    );

    const after = await withReadTx((tx) =>
      resolveMemberAccessLevel(tx, { workspaceId, memberId, contextId }),
    );
    expect(after).toBe(0);
  });

  it("getAccessScoped returns not-found for a suspended member, identically to a stranger", async () => {
    const memberId = await addMember("human");

    const wb = await workerDb();
    // Gives this member a full binding on the workspace's own context, the
    // same context the acceptance criterion's example uses.
    await runOperation(
      { pool: wb.appPool },
      {
        action: "test.bind",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx }) {
          const context = await resolveSubjectContext(
            tx,
            "workspace",
            workspaceId,
            workspaceId,
          );
          const groupId = await ensureMemberGroup(tx, {
            workspaceId,
            memberId,
          });
          await bindGroup(tx, {
            workspaceId,
            groupId,
            contextId: (context as { contextId: string }).contextId,
            level: ACCESS_LEVELS.full,
          });
          return {
            result: undefined,
            activity: {
              kind: "test.bind",
              subjectType: "workspace",
              subjectId: workspaceId,
            },
            audit: { action: "test.bind", targetType: "workspace" },
          };
        },
      },
    );

    await wb.admin.query(
      "update workspace_members set status = 'suspended', suspended_at = now() where id = $1",
      [memberId],
    );

    await expect(
      withReadTx((tx) =>
        getAccessScoped(tx, {
          workspaceId,
          memberId,
          resourceType: "workspace",
          resourceId: workspaceId,
          requires: ACCESS_LEVELS.view,
        }),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("no existence oracle: forbidden and missing look identical", () => {
  it("a member with an insufficient level gets the same not-found as a nonexistent resource", async () => {
    const memberId = await addMember("human");
    // "blob", not the synthetic "test-aggregate" makeContext uses elsewhere:
    // getAccessScoped resolves resourceType through the real, exhaustive
    // SUBJECT_RESOLVERS map, unlike queryFeed's own contextId shortcut, so
    // this test needs a registered type its resourceId actually round-trips
    // through, this call and the bind below sharing the same id.
    const resourceId = randomUUID();

    const wb = await workerDb();
    await runOperation(
      { pool: wb.appPool },
      {
        action: "test.bind",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx }) {
          const contextId = await ensureContext(tx, {
            workspaceId,
            resourceType: "blob",
            resourceId,
          });
          const groupId = await ensureMemberGroup(tx, {
            workspaceId,
            memberId,
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
              kind: "test.bind",
              subjectType: "blob",
              subjectId: resourceId,
            },
            audit: { action: "test.bind", targetType: "blob" },
          };
        },
      },
    );

    const insufficientLevel = await withReadTx((tx) =>
      getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "blob",
        resourceId,
        requires: ACCESS_LEVELS.edit,
      }),
    ).catch((error: unknown) => error);
    const missingResource = await withReadTx((tx) =>
      getAccessScoped(tx, {
        workspaceId,
        memberId,
        resourceType: "blob",
        resourceId: randomUUID(),
        requires: ACCESS_LEVELS.view,
      }),
    ).catch((error: unknown) => error);

    expect(insufficientLevel).toBeInstanceOf(OperationError);
    expect(missingResource).toBeInstanceOf(OperationError);
    expect((insufficientLevel as OperationError).code).toBe("not_found");
    expect((missingResource as OperationError).code).toBe("not_found");
    expect((insufficientLevel as OperationError).message).toBe(
      (missingResource as OperationError).message,
    );
  });
});

describe("the subject-to-context resolver is fail-closed", () => {
  it("raises for a subject type it has no resolver for", async () => {
    await expect(
      withReadTx((tx) =>
        resolveSubjectContext(tx, "no-such-subject-type", "x", workspaceId),
      ),
    ).rejects.toThrow(/no context resolver registered/i);
  });

  it("resolves the workspace itself through the workspace resolver", async () => {
    const context = await withReadTx((tx) =>
      resolveSubjectContext(tx, "workspace", workspaceId, workspaceId),
    );
    expect(context?.contextId).toBeTruthy();
  });
});

describe("the composable list filter scopes many rows the same way a single read does", () => {
  it("lists only the probes the member can see, at the required level", async () => {
    const memberId = await addMember("human");
    const visibleContext = await makeContext("list-visible");
    const tooLowContext = await makeContext("list-too-low");
    const invisibleContext = await makeContext("list-invisible");

    const wb = await workerDb();
    await runOperation(
      { pool: wb.appPool },
      {
        action: "test.bind-many",
        workspaceId,
        actor: { kind: "human", userId: OWNER },
        async execute({ tx }) {
          const groupId = await ensureMemberGroup(tx, {
            workspaceId,
            memberId,
          });
          await bindGroup(tx, {
            workspaceId,
            groupId,
            contextId: visibleContext,
            level: ACCESS_LEVELS.edit,
          });
          await bindGroup(tx, {
            workspaceId,
            groupId,
            contextId: tooLowContext,
            level: ACCESS_LEVELS.view,
          });
          return {
            result: undefined,
            activity: {
              kind: "test.bind-many",
              subjectType: "test-aggregate",
              subjectId: visibleContext,
            },
            audit: { action: "test.bind-many", targetType: "test-aggregate" },
          };
        },
      },
    );

    await wb.admin.query(
      `insert into access_probes (id, workspace_id, context_id, title) values
         (gen_random_uuid(), $1, $2, 'visible'),
         (gen_random_uuid(), $1, $3, 'too-low'),
         (gen_random_uuid(), $1, $4, 'invisible')`,
      [workspaceId, visibleContext, tooLowContext, invisibleContext],
    );

    const rows = await withReadTx((tx) =>
      tx
        .select({ title: accessProbes.title })
        .from(accessProbes)
        .where(
          and(
            activeOnly(accessProbes, eq(accessProbes.workspaceId, workspaceId)),
            accessScopeFilter(accessProbes.contextId, {
              workspaceId,
              memberId,
              minLevel: ACCESS_LEVELS.edit,
            }),
          ),
        ),
    );

    expect(rows.map((r) => r.title)).toEqual(["visible"]);
  });
});
