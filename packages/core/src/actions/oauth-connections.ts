/**
 * The connections a person granted, and ending one (screen S-40, P5-T08c).
 *
 * **A grant is personal, exactly as an API token is.** Each belongs to the
 * member who approved it, and these read and write the acting member's own rows
 * and take no member id: an action that accepted one would be an action somebody
 * could aim at a colleague.
 *
 * **Revoking is not deleting, and the reason is kept.** "You ended this" and
 * "a refresh token was presented twice" are very different things to read weeks
 * later, and the second is the only way a person finds out their agent was
 * compromised.
 */
import {
  activeOnly,
  oauthClients,
  oauthGrants,
  withWorkspace,
} from "@openokr/db";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { REVOCATION_REASONS, revokeGrant } from "../api/oauth/grants.ts";
import { OperationError } from "../operations/operation.ts";
import { actingMemberId } from "./api-tokens.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const iso = (value: Date | null) => (value ? value.toISOString() : null);

const connectionSummary = z.object({
  id: z.uuid(),
  clientName: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  /** The sentence a person reads, not the stored key. */
  revokedReason: z.string().nullable(),
  createdAt: z.string(),
});

export const listMyConnections = defineReadAction({
  name: "connections.mine",
  summary: "The external agents this member connected, newest first.",
  input: z.object({}),
  output: z.object({ connections: z.array(connectionSummary) }),
  access: ACCESS_LEVELS.view,
  async handler(context) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, async (tx) => {
      const memberId = await actingMemberId(
        tx,
        context.workspaceId,
        context.actor.userId,
      );
      const rows = await tx
        .select({
          id: oauthGrants.id,
          scopes: oauthGrants.scopes,
          lastUsedAt: oauthGrants.lastUsedAt,
          revokedAt: oauthGrants.revokedAt,
          revokedReason: oauthGrants.revokedReason,
          createdAt: oauthGrants.createdAt,
          clientName: oauthClients.name,
        })
        .from(oauthGrants)
        .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
        .where(
          activeOnly(
            oauthGrants,
            eq(oauthGrants.workspaceId, context.workspaceId),
            eq(oauthGrants.memberId, memberId),
          ),
        )
        .orderBy(desc(oauthGrants.createdAt));

      return {
        connections: rows.map((row) => ({
          id: row.id,
          clientName: row.clientName,
          scopes: row.scopes,
          lastUsedAt: iso(row.lastUsedAt),
          revokedAt: iso(row.revokedAt),
          revokedReason: row.revokedReason
            ? (REVOCATION_REASONS[
                row.revokedReason as keyof typeof REVOCATION_REASONS
              ] ?? row.revokedReason)
            : null,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    });
  },
});

export const revokeConnection = defineWriteAction({
  name: "connections.revoke",
  summary: "End one of your own connections to an external agent.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.edit,
  // Destructive: it takes away a capability something is currently using, and
  // there is no undo.
  safety: "destructive",
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      if (!actor.memberId) {
        throw new OperationError("forbidden", "No member.");
      }

      // Read first, scoped to this member's own rows, so somebody else's grant
      // is not-found rather than refused and a probe learns nothing.
      const [grant] = await tx
        .select({ id: oauthGrants.id, revokedAt: oauthGrants.revokedAt })
        .from(oauthGrants)
        .where(
          activeOnly(
            oauthGrants,
            eq(oauthGrants.workspaceId, workspaceId),
            eq(oauthGrants.id, input.id),
            eq(oauthGrants.memberId, actor.memberId),
          ),
        )
        .limit(1);

      if (!grant || grant.revokedAt) {
        throw new OperationError(
          "not_found",
          "No such connection, or it is already revoked.",
        );
      }

      await revokeGrant(tx, {
        workspaceId,
        grantId: grant.id,
        reason: "member",
        now: new Date(),
      });

      return {
        result: { id: grant.id },
        activity: {
          kind: "connection.revoked",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { grantId: grant.id },
        },
        audit: {
          action: "connections.revoke",
          targetType: "oauth_grant",
          targetId: grant.id,
          payload: { grantId: grant.id },
        },
      };
    },
  }),
});
