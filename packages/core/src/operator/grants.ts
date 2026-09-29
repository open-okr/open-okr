/**
 * Granting and revoking the operator role (completeness review H-21).
 *
 * The design says the first operator "is created by the deployment, not by a
 * screen", because a screen that creates the first operator can be reached by
 * whoever gets there first. Nothing implemented that, so the UAT guide told
 * people to insert the row by hand. `pnpm cloud:operator` is the deployment's
 * way in: whoever can run it already holds `DATABASE_URL`.
 *
 * **Never self**, which the table's own check constraint enforces. Once one
 * operator holds a live grant, only an operator may grant another. Before
 * that, the grant names the person who ran the command as any other signed-up
 * user, so the trail always says who vouched for whom.
 *
 * Both are recorded on the instance audit chain, since neither belongs to a
 * workspace.
 */
import { instanceOperators, users, withInstanceAdmin } from "@openokr/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { recordInstanceAuditEvent } from "../audit/instance-chain.ts";

export class OperatorGrantError extends Error {}

async function userIdByEmail(
  pool: Pool,
  email: string,
): Promise<string | null> {
  const db = drizzle(pool);
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.trim().toLowerCase()))
    .limit(1);
  return row?.id ?? null;
}

async function requireUser(pool: Pool, email: string): Promise<string> {
  const id = await userIdByEmail(pool, email);
  if (!id) {
    throw new OperatorGrantError(
      `Nobody has signed up as ${email}. They have to create an account first.`,
    );
  }
  return id;
}

export type GrantOutcome = "granted" | "regranted" | "already";

export async function grantOperator(
  pool: Pool,
  input: {
    readonly email: string;
    readonly grantedByEmail: string;
    readonly note?: string | null;
  },
): Promise<GrantOutcome> {
  const userId = await requireUser(pool, input.email);
  const grantedBy = await requireUser(pool, input.grantedByEmail);
  if (userId === grantedBy) {
    throw new OperatorGrantError(
      "Nobody grants the operator role to themselves. Name somebody else with --granted-by.",
    );
  }

  const db = drizzle(pool);
  const outcome = await withInstanceAdmin(db, async (tx) => {
    const live = await tx
      .select({ userId: instanceOperators.userId })
      .from(instanceOperators)
      .where(isNull(instanceOperators.revokedAt));
    if (live.length > 0 && !live.some((row) => row.userId === grantedBy)) {
      throw new OperatorGrantError(
        `${input.grantedByEmail} is not an operator. Once one exists, only an operator can grant another.`,
      );
    }
    const [existing] = await tx
      .select({ revokedAt: instanceOperators.revokedAt })
      .from(instanceOperators)
      .where(eq(instanceOperators.userId, userId))
      .limit(1);
    if (existing && existing.revokedAt === null) {
      return "already" as const;
    }
    const values = {
      grantedByUserId: grantedBy,
      grantedAt: new Date(),
      revokedAt: null,
      note: input.note ?? null,
    };
    if (existing) {
      // openokr:allow-mutation: an instance-level grant, above the tenant floor and outside any workspace, like `writeSettings`.
      await tx
        .update(instanceOperators)
        .set(values)
        .where(eq(instanceOperators.userId, userId));
      return "regranted" as const;
    }
    // openokr:allow-mutation: an instance-level grant, above the tenant floor and outside any workspace, like `writeSettings`.
    await tx.insert(instanceOperators).values({ userId, ...values });
    return "granted" as const;
  });

  if (outcome !== "already") {
    await recordInstanceAuditEvent(pool, {
      action: "operator.granted",
      payload: { userId, grantedByUserId: grantedBy },
    });
  }
  return outcome;
}

export async function revokeOperator(
  pool: Pool,
  input: { readonly email: string; readonly revokedByEmail: string },
): Promise<boolean> {
  const userId = await requireUser(pool, input.email);
  const revokedBy = await requireUser(pool, input.revokedByEmail);
  const db = drizzle(pool);
  const revoked = await withInstanceAdmin(db, async (tx) => {
    // openokr:allow-mutation: an instance-level grant, above the tenant floor and outside any workspace, like `writeSettings`.
    const rows = await tx
      .update(instanceOperators)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(instanceOperators.userId, userId),
          isNull(instanceOperators.revokedAt),
        ),
      )
      .returning({ userId: instanceOperators.userId });
    return rows.length > 0;
  });
  if (revoked) {
    await recordInstanceAuditEvent(pool, {
      action: "operator.revoked",
      payload: { userId, revokedByUserId: revokedBy },
    });
  }
  return revoked;
}
