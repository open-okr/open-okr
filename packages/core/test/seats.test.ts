import { newId } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionMemberForInvite } from "../src/invitations/provisioning.ts";
import { countSeats, seatState } from "../src/tenancy/index.ts";
import { createWorkspace } from "../src/workspaces/provisioning.ts";

/**
 * Seats (P8-T05, design in `docs/design/p8-t01b-plans-and-seats.md`).
 *
 * Three claims:
 *
 *   1. A self-hosted instance is never seat-limited, and that costs no code
 *      path: there is no `tenants` row, so the limit is null.
 *   2. A seat is a human who is here or on their way. A guest, an agent and a
 *      placeholder are never seats.
 *   3. **Both enforcement points are needed.** The invitation refusal is the
 *      one a person can act on; the funnel refusal is the one that must be
 *      right, because one reusable link admits everybody who holds it.
 */

const OWNER = "seat-owner";
let workspaceId: string;

const seedUser = async (id: string) => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into users (id, name, email) values ($1, $2, $3) on conflict do nothing",
    [id, id, `${id}@example.com`],
  );
};

/** Makes this a cloud workspace on a plan of `seats`. */
const onPlan = async (seats: number | null) => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into tenants (workspace_id, state, region, seats) values ($1, 'active', 'local', $2) on conflict (workspace_id) do update set seats = excluded.seats",
    [workspaceId, seats],
  );
};

const invite = async () => {
  const wb = await workerDb();
  return callAction(
    {
      pool: wb.appPool,
      workspaceId,
      actor: { kind: "human", userId: OWNER },
    },
    "invitations.createWorkspaceLink",
    {},
  );
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.truncateAllTables();
  await seedUser(OWNER);
  workspaceId = (
    await createWorkspace(wb.appPool, { user: { id: OWNER, name: "Owner" } })
  ).workspaceId;
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("a self-hosted instance is never seat-limited", () => {
  it("reports no limit, because there is no tenant row to read", async () => {
    const wb = await workerDb();
    await expect(seatState(wb.appPool, workspaceId)).resolves.toMatchObject({
      limit: null,
      full: false,
    });
  });

  it("lets an invitation through however many members there are", async () => {
    // No tenant row, so no second code path and no flag: the check reads a
    // null limit and returns.
    await expect(invite()).resolves.toBeTruthy();
  });
});

describe("what counts as a seat", () => {
  it("counts the one human a fresh workspace has", async () => {
    // Provisioning writes one human member, the Coach and the Champion.
    const wb = await workerDb();
    await expect(countSeats(wb.appPool, workspaceId)).resolves.toBe(1);
  });

  it("does not count the agents that ship with every workspace", async () => {
    const wb = await workerDb();
    const { rows } = await wb.admin.query(
      "select count(*)::int n from workspace_members where workspace_id = $1 and kind = 'agent'",
      [workspaceId],
    );
    // Two of them, and neither is a seat. Charging for the Coach and the
    // Champion would gate the product's premise behind a plan.
    expect(rows[0].n).toBe(2);
    await expect(countSeats(wb.appPool, workspaceId)).resolves.toBe(1);
  });

  it("counts an invited human, before they have clicked anything", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "insert into workspace_members (id, workspace_id, name, kind, status) values ($1, $2, $3, 'human', 'invited')",
      [newId(), workspaceId, "Invited person"],
    );
    // The load-bearing choice. If this were 1, a full workspace could invite a
    // hundred people and every one of them would meet the refusal at the
    // moment they clicked.
    await expect(countSeats(wb.appPool, workspaceId)).resolves.toBe(2);
  });

  it("stops counting somebody the day they are suspended", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "update workspace_members set status = 'suspended' where workspace_id = $1 and kind = 'human'",
      [workspaceId],
    );
    await expect(countSeats(wb.appPool, workspaceId)).resolves.toBe(0);
  });

  it("does not count a guest, so a support session is free", async () => {
    const wb = await workerDb();
    await wb.admin.query(
      "insert into workspace_members (id, workspace_id, name, kind, status) values ($1, $2, $3, 'guest', 'active')",
      [newId(), workspaceId, "OpenOKR support"],
    );
    await expect(countSeats(wb.appPool, workspaceId)).resolves.toBe(1);
  });
});

describe("both enforcement points", () => {
  it("refuses the invitation, naming both numbers", async () => {
    await onPlan(1);
    // One human already, so there is no room.
    await expect(invite()).rejects.toThrow(/1 of 1 seats/);
  });

  it("refuses at the funnel too, which is what a reusable link needs", async () => {
    // **The case the invitation check alone cannot cover.** One workspace
    // link admits everybody who holds it, so a plan checked only at invite
    // time can be overflowed by any amount.
    const wb = await workerDb();
    // Room for two, and the link is made while there is room.
    await onPlan(2);
    await expect(invite()).resolves.toBeTruthy();

    // Somebody takes the second seat.
    await seedUser("joiner-one");
    await wb.admin.query(
      "insert into workspace_members (id, workspace_id, user_id, name, kind, status) values ($1, $2, $3, $4, 'human', 'active')",
      [newId(), workspaceId, "joiner-one", "Joiner One"],
    );

    // A third person opens the same link. The invitation was valid when it
    // was made and is not now.
    await seedUser("joiner-two");
    const db = (await import("drizzle-orm/node-postgres")).drizzle(wb.appPool);
    const { withWorkspace } = await import("@openokr/db");
    await expect(
      withWorkspace(db, workspaceId, (tx) =>
        provisionMemberForInvite(tx, {
          workspaceId,
          user: { id: "joiner-two", name: "Joiner Two" },
        }),
      ),
    ).rejects.toThrow(/full/);
  });

  it("lets a guest in when the humans are full, because a guest is not a seat", async () => {
    const wb = await workerDb();
    await onPlan(1);
    await seedUser("support-person");
    const db = (await import("drizzle-orm/node-postgres")).drizzle(wb.appPool);
    const { withWorkspace } = await import("@openokr/db");
    await expect(
      withWorkspace(db, workspaceId, (tx) =>
        provisionMemberForInvite(tx, {
          workspaceId,
          user: { id: "support-person", name: "OpenOKR support" },
          kind: "guest",
        }),
      ),
    ).resolves.toMatchObject({ created: true });
  });

  it("lets an invitation through on an unlimited plan", async () => {
    await onPlan(null);
    await expect(invite()).resolves.toBeTruthy();
  });
});
