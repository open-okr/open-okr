/**
 * An operator creates a workspace for somebody (docs/design/hosting-profiles.md §3).
 *
 * This is how a group gets a workspace per company, and how a provider sets up a
 * customer under an invitation-only policy.
 *
 * **The operator never becomes a member.** The role is deliberately outside every
 * workspace (`operator-console.md`), so the first administrator is the person the
 * operator names. With an account they own it straight away. Without one, the
 * workspace waits for them with an invitation out, and accepting it claims the
 * owner's row.
 */

import { users } from "@openokr/db";
import { EMAIL_PATTERN } from "@openokr/formats";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { z } from "zod";
import { recordInstanceAuditEvent } from "../audit/instance-chain.ts";
import { OperationError } from "../operations/operation.ts";
import { isCloudEnabled } from "../tenancy/index.ts";
import {
  createWorkspace,
  type ProvisionedWorkspace,
} from "../workspaces/provisioning.ts";
import { isLiveOperator } from "./store.ts";

const inputSchema = z.object({
  name: z.string().trim().min(1, "A workspace needs a name.").max(200),
  ownerEmail: z.string().trim().toLowerCase().email({
    pattern: EMAIL_PATTERN,
    message: "That is not an email address.",
  }),
});

export interface OperatorWorkspaceResult extends ProvisionedWorkspace {
  /** False when the owner has no account yet and an invitation went out. */
  readonly ownerHadAccount: boolean;
}

export async function createWorkspaceAsOperator(
  pool: Pool,
  input: {
    readonly operatorUserId: string;
    readonly name: string;
    readonly ownerEmail: string;
  },
): Promise<OperatorWorkspaceResult> {
  // The same not-found the rest of the console gives, for the same reason.
  if (
    !(await isCloudEnabled(pool)) ||
    !(await isLiveOperator(pool, input.operatorUserId))
  ) {
    throw new OperationError("not_found", "No such workspace.");
  }
  const { name, ownerEmail } = inputSchema.parse(input);

  const [owner] = await drizzle(pool)
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(sql`lower(${users.email})`, ownerEmail))
    .limit(1);

  const created = await createWorkspace(pool, {
    name,
    ...(owner
      ? { user: { id: owner.id, name: owner.name } }
      : { waitingOwner: { email: ownerEmail } }),
  });

  await recordInstanceAuditEvent(pool, {
    action: "operator.workspace_created",
    payload: {
      workspaceId: created.workspaceId,
      operatorUserId: input.operatorUserId,
      ownerHadAccount: Boolean(owner),
    },
  });
  return { ...created, ownerHadAccount: Boolean(owner) };
}
