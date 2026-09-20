/**
 * Landing a person in the workspace that vouched for them (P8-T07b).
 *
 * Two paths know which workspace an arriving account belongs to, and neither
 * had a way to say so. An identity provider's callback knows it, because the
 * provider was configured by one workspace. A SCIM request knows it, because
 * the bearer token belongs to one workspace.
 *
 * Without this, both fell through to `provisionWorkspaceForUser`, which gives
 * a person with no membership anywhere a workspace of their own. So the first
 * employee to sign in through their company's Okta landed alone in a fresh
 * empty workspace and never saw the one that had configured Okta, which is
 * the opposite of what "just-in-time provisioning landing in the one member
 * funnel" describes.
 *
 * This is the same arrangement an invitation has: join first, then let
 * `provisionWorkspaceForUser` find that membership and return it rather than
 * make a second one. The order is the whole of it.
 */
import { activeOnly, withWorkspace, workspaceMembers } from "@openokr/db";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { provisionMemberForInvite } from "../invitations/provisioning.ts";
import { OperationError, runOperation } from "../operations/operation.ts";

/** This person's live membership of that workspace, or null. */
async function liveMemberId(
  pool: Pool,
  workspaceId: string,
  userId: string,
): Promise<string | null> {
  const [row] = await withWorkspace(drizzle(pool), workspaceId, (tx) =>
    tx
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        activeOnly(
          workspaceMembers,
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, userId),
          ),
        ),
      )
      .limit(1),
  );
  return row?.id ?? null;
}

export interface DirectoryJoinInput {
  readonly workspaceId: string;
  readonly user: { readonly id: string; readonly name: string };
  /** What vouched for them, for the audit row. */
  readonly via: "sso" | "directory_sync";
  /** The identity provider's own id for this person, when it has one. */
  readonly externalId?: string;
}

export interface DirectoryJoinResult {
  readonly memberId: string;
  readonly created: boolean;
}

/**
 * Makes this person a member of that workspace, through the one funnel.
 *
 * **A system actor**, and the authorisation happens before the Operation
 * opens rather than inside it: the caller has already verified an identity
 * provider's callback or a bearer token, and an `ActorInput` is constructed
 * on the server and never taken from a request. The same arrangement
 * `workspace.provision` and the cloud operator use.
 *
 * At the level every other joining path uses, which is the funnel's own
 * default. There is no second opinion about what a new member may do, and
 * nothing an external system sends decides it.
 *
 * Idempotent: somebody who is already a member gets that membership back.
 */
export async function joinWorkspaceForIdentity(
  pool: Pool,
  input: DirectoryJoinInput,
): Promise<DirectoryJoinResult> {
  // **Answered before an Operation is opened, because every Operation writes
  // an activity row.** A directory reconciling five hundred people every hour
  // is not five hundred events an hour; it is a directory talking to itself,
  // and the feed is for the workspace rather than for the machinery.
  //
  // Two concurrent calls for the same newcomer can both pass this and both
  // write an event. The funnel inside the Operation still refuses the second
  // membership, so the cost of that race is a duplicate line in the feed
  // rather than a duplicate member.
  const existing = await liveMemberId(pool, input.workspaceId, input.user.id);
  if (existing) {
    return { memberId: existing, created: false };
  }

  return runOperation(
    { pool },
    {
      action: "workspace.directoryJoin",
      workspaceId: input.workspaceId,
      actor: { kind: "system" },
      async execute({ tx, workspaceId }) {
        const member = await provisionMemberForInvite(tx, {
          workspaceId,
          user: input.user,
        });

        return {
          result: { memberId: member.memberId, created: member.created },
          activity: {
            kind: "member.joined_by_directory",
            subjectType: "workspace_member",
            subjectId: member.memberId,
            payload: { via: input.via },
          },
          audit: {
            action: "workspace.directoryJoin",
            targetType: "member",
            targetId: member.memberId,
            payload: {
              via: input.via,
              userId: input.user.id,
              created: member.created,
              ...(input.externalId ? { externalId: input.externalId } : {}),
            },
          },
        };
      },
    },
  );
}

/**
 * The same, but never failing the caller.
 *
 * The identity provider's callback uses this. By the time it runs, Better
 * Auth has committed the account and the browser is mid-redirect, so throwing
 * would leave somebody signed in with an error page instead of a workspace.
 * Whatever went wrong is written out and `provisionWorkspaceForUser` still
 * gives them somewhere to be, which is the behaviour every account had before
 * this path existed.
 */
export async function tryJoinWorkspaceForIdentity(
  pool: Pool,
  input: DirectoryJoinInput,
): Promise<DirectoryJoinResult | null> {
  try {
    return await joinWorkspaceForIdentity(pool, input);
  } catch (error) {
    const reason =
      error instanceof OperationError || error instanceof Error
        ? error.message
        : String(error);
    process.stderr.write(
      `directory-join: could not add ${input.user.id} to ` +
        `${input.workspaceId} via ${input.via}: ${reason}\n`,
    );
    return null;
  }
}
