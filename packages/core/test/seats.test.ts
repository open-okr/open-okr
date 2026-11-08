import { newId } from "@openokr/db";
import { workerDb } from "@openokr/test-support/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { callAction } from "../src/actions/registry.ts";
import { provisionMemberForInvite } from "../src/invitations/provisioning.ts";
import {
  countSeats,
  listSeatHolders,
  seatState,
} from "../src/tenancy/index.ts";
import { applyPlanInTx } from "../src/tenancy/plans.ts";
import { createWorkspace } from "../src/workspaces/provisioning.ts";

/**
 * Seats (P8-T05, design in `docs/design/plans-and-seats.md`).
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

/**
 * A pending invitation holds a seat (plans-and-seats.md §2, the matrix's D-1).
 *
 * The rule above was only ever true of a member row with status `invited`,
 * which no path writes: a personal invitation writes a link and no member until
 * it is accepted. So with seats free, any number of invitations succeeded and
 * the surplus met the refusal at the link. These count the link itself.
 */
describe("a pending invitation holds a seat", () => {
  const personal = async (
    email: string,
    options: { readonly expiresInDays?: number } = {},
  ) => {
    const wb = await workerDb();
    return callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human", userId: OWNER },
      },
      "invitations.createPersonalLink",
      { email, ...options },
    );
  };

  const used = async (id = workspaceId) => {
    const wb = await workerDb();
    return (await seatState(wb.appPool, id)).used;
  };

  it("from the moment it is sent, before anybody clicks", async () => {
    await onPlan(3);
    await personal("first@example.com");
    await expect(used()).resolves.toBe(2);
  });

  it("so the invitation past the limit is refused, naming both numbers", async () => {
    await onPlan(3);
    await personal("first@example.com");
    await personal("second@example.com");
    await expect(personal("third@example.com")).rejects.toThrow(
      /3 of 3 seats in use/,
    );
  });

  it("and the invited person takes the seat it holds, rather than being refused for it", async () => {
    const wb = await workerDb();
    await onPlan(2);
    await seedUser("joiner");
    const link = await personal("joiner@example.com");
    await expect(used()).resolves.toBe(2);
    await expect(
      callAction(
        {
          pool: wb.appPool,
          workspaceId,
          actor: { kind: "human", userId: "joiner" },
        },
        "invitations.acceptLink",
        { token: link.token },
      ),
    ).resolves.toBeTruthy();
    await expect(used()).resolves.toBe(2);
  });

  it("once per address, so asking the same person again needs no second seat", async () => {
    await onPlan(2);
    await personal("first@example.com");
    await expect(personal("first@example.com")).resolves.toBeTruthy();
    await expect(used()).resolves.toBe(2);
  });

  it("until it is revoked", async () => {
    const wb = await workerDb();
    await onPlan(2);
    const link = await personal("first@example.com");
    await callAction(
      {
        pool: wb.appPool,
        workspaceId,
        actor: { kind: "human", userId: OWNER },
      },
      "invitations.revokeLink",
      { linkId: link.id },
    );
    await expect(used()).resolves.toBe(1);
    await expect(personal("second@example.com")).resolves.toBeTruthy();
  });

  it("until it expires", async () => {
    const wb = await workerDb();
    await onPlan(2);
    await personal("first@example.com");
    await wb.admin.query(
      "update invite_links set expires_at = now() - interval '1 minute' where workspace_id = $1",
      [workspaceId],
    );
    await expect(used()).resolves.toBe(1);
  });

  it("but not for somebody already here", async () => {
    await onPlan(3);
    await personal(`${OWNER}@example.com`);
    await expect(used()).resolves.toBe(1);
  });

  it("and not twice for the owner an operator's workspace is waiting for", async () => {
    const wb = await workerDb();
    const waiting = (
      await createWorkspace(wb.appPool, {
        waitingOwner: { email: "new.owner@example.com" },
      })
    ).workspaceId;
    await wb.admin.query(
      "insert into tenants (workspace_id, state, region, seats) values ($1, 'active', 'local', 3)",
      [waiting],
    );
    // The waiting member is the seat; the invitation that will claim it is not a second.
    await expect(used(waiting)).resolves.toBe(1);
  });

  it("is named among the seat holders, so an administrator can see whose it is", async () => {
    const wb = await workerDb();
    await onPlan(3);
    await personal("first@example.com");
    await expect(listSeatHolders(wb.appPool, workspaceId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "first@example.com",
          status: "invited",
        }),
      ]),
    );
  });

  it("but the headcount a smaller plan is judged by is the people, not the invitations", async () => {
    const wb = await workerDb();
    await onPlan(5);
    await personal("first@example.com");
    await personal("second@example.com");
    const db = (await import("drizzle-orm/node-postgres")).drizzle(wb.appPool);
    const { withWorkspace } = await import("@openokr/db");
    // One person and two invitations, onto two seats: nobody loses access, so
    // it is allowed, and the funnel refuses whoever arrives without a seat.
    await expect(
      withWorkspace(db, workspaceId, (tx) =>
        applyPlanInTx(tx, { workspaceId, plan: null, seats: 2 }),
      ),
    ).resolves.toBe(true);
  });
});
