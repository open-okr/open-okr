/**
 * An administrator's view of the workspace's agent connections, and the power
 * to end one (docs/design/agent-connections-admin.md, plan 0.7.0 A4, approved
 * by Akmal on 9 November 2026 with agent API tokens and an inbox notice).
 *
 * Each member saw only their own, at /account/connections, and an
 * administrator could end a colleague's only by suspending the colleague,
 * which ends every connection they have. Ending one is strictly less than
 * that, and so is seeing them, which is why both ask for `full`, the level
 * that may already suspend (D2).
 *
 * **Both are for the signed-in browser only** (D3). A leaked token or an
 * administrator's own agent must not be able to list who uses which agent, or
 * switch a colleague's off, so neither is an agent tool and both refuse any
 * call that arrives through a channel.
 *
 * `connections.mine` and `connections.revoke` are unchanged and still take no
 * member id (D1).
 */
import {
  activeOnly,
  apiTokens,
  oauthClients,
  oauthGrants,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { clientDisplayName } from "../api/oauth/clients.ts";
import { REVOCATION_REASONS, revokeGrant } from "../api/oauth/grants.ts";
import { notifyRecipients } from "../notifications/create.ts";
import { OperationError } from "../operations/operation.ts";
import { refuseUnlessSignedIn } from "./api-tokens.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

const PAGE_SIZE = 50;

const iso = (value: Date | null) => (value ? value.toISOString() : null);

/**
 * One row of the list (D10). Never a token, a code, a hash, a redirect
 * address, an email or a network address (D11): none of it helps decide
 * whether a connection should exist.
 */
const connectionRow = z.object({
  kind: z.enum(["grant", "token"]),
  id: z.uuid(),
  memberId: z.uuid(),
  memberName: z.string(),
  memberActive: z.boolean(),
  /** The client's display name, or the token's own name. */
  label: z.string(),
  scopes: z.array(z.string()),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  revokedReason: z.string().nullable(),
});

const SIGNED_IN_ONLY =
  "Agent connections are listed and ended on Admin, Agent connections, signed in. A token or an agent cannot reach them.";

export const listWorkspaceConnections = defineReadAction({
  name: "connections.list",
  agentSurface: false,
  summary:
    "Every agent connection and agent token in the workspace, for an administrator.",
  input: z.object({
    /** Live by default (D10). */
    state: z.enum(["live", "ended", "all"]).default("live"),
    page: z.number().int().min(0).default(0),
  }),
  output: z.object({
    items: z.array(connectionRow),
    hasMore: z.boolean(),
  }),
  access: ACCESS_LEVELS.full,
  async handler(context, input) {
    refuseUnlessSignedIn(context, SIGNED_IN_ONLY);
    const db = drizzle(context.pool);
    const reasonFor = (stored: string | null) =>
      stored
        ? (REVOCATION_REASONS[stored as keyof typeof REVOCATION_REASONS] ??
          stored)
        : null;

    return withWorkspace(db, context.workspaceId, async (tx) => {
      const grantState =
        input.state === "live"
          ? isNull(oauthGrants.revokedAt)
          : input.state === "ended"
            ? isNotNull(oauthGrants.revokedAt)
            : undefined;
      const tokenState =
        input.state === "live"
          ? isNull(apiTokens.revokedAt)
          : input.state === "ended"
            ? isNotNull(apiTokens.revokedAt)
            : undefined;

      // Only clients with a grant in this workspace appear, through the join:
      // the instance's client list spans every workspace (D12).
      const grants = await tx
        .select({
          id: oauthGrants.id,
          memberId: oauthGrants.memberId,
          memberName: workspaceMembers.name,
          memberStatus: workspaceMembers.status,
          clientId: oauthClients.clientId,
          clientName: oauthClients.name,
          scopes: oauthGrants.scopes,
          createdAt: oauthGrants.createdAt,
          lastUsedAt: oauthGrants.lastUsedAt,
          revokedAt: oauthGrants.revokedAt,
          revokedReason: oauthGrants.revokedReason,
        })
        .from(oauthGrants)
        .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
        .innerJoin(
          workspaceMembers,
          eq(workspaceMembers.id, oauthGrants.memberId),
        )
        .where(
          activeOnly(
            oauthGrants,
            eq(oauthGrants.workspaceId, context.workspaceId),
            grantState,
          ),
        )
        .orderBy(desc(oauthGrants.createdAt));

      // Agent tokens only: the `mcp` audience is how an agent connects with a
      // token instead of a grant (Akmal's Q2 answer). REST tokens are not an
      // agent connection.
      const tokens = await tx
        .select({
          id: apiTokens.id,
          memberId: apiTokens.memberId,
          memberName: workspaceMembers.name,
          memberStatus: workspaceMembers.status,
          name: apiTokens.name,
          scopes: apiTokens.scopes,
          createdAt: apiTokens.createdAt,
          lastUsedAt: apiTokens.lastUsedAt,
          revokedAt: apiTokens.revokedAt,
          revokedReason: apiTokens.revokedReason,
        })
        .from(apiTokens)
        .innerJoin(
          workspaceMembers,
          eq(workspaceMembers.id, apiTokens.memberId),
        )
        .where(
          activeOnly(
            apiTokens,
            and(
              eq(apiTokens.workspaceId, context.workspaceId),
              eq(apiTokens.audience, "mcp"),
            ),
            tokenState,
          ),
        )
        .orderBy(desc(apiTokens.createdAt));

      const rows = [
        ...grants.map((row) => ({
          kind: "grant" as const,
          id: row.id,
          memberId: row.memberId,
          memberName: row.memberName,
          memberActive: row.memberStatus === "active",
          label: clientDisplayName(
            { clientId: row.clientId, name: row.clientName },
            context.instanceName,
          ),
          scopes: [...row.scopes],
          createdAt: row.createdAt.toISOString(),
          lastUsedAt: iso(row.lastUsedAt),
          revokedAt: iso(row.revokedAt),
          revokedReason: reasonFor(row.revokedReason),
        })),
        ...tokens.map((row) => ({
          kind: "token" as const,
          id: row.id,
          memberId: row.memberId,
          memberName: row.memberName,
          memberActive: row.memberStatus === "active",
          label: row.name,
          scopes: [...row.scopes],
          createdAt: row.createdAt.toISOString(),
          lastUsedAt: iso(row.lastUsedAt),
          revokedAt: iso(row.revokedAt),
          revokedReason: reasonFor(row.revokedReason),
        })),
      ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

      const start = input.page * PAGE_SIZE;
      return {
        items: rows.slice(start, start + PAGE_SIZE),
        hasMore: rows.length > start + PAGE_SIZE,
      };
    });
  },
});

export const revokeConnectionAsAdmin = defineWriteAction({
  name: "connections.revokeAsAdmin",
  agentSurface: false,
  summary:
    "End a member's agent connection or agent token, as an administrator.",
  input: z.object({
    kind: z.enum(["grant", "token"]),
    /** A grant's or a token's id, never a member's (D4). */
    id: z.uuid(),
  }),
  output: z.object({ id: z.uuid() }),
  access: ACCESS_LEVELS.full,
  safety: "destructive",
  operation: (context, input) => {
    refuseUnlessSignedIn(context, SIGNED_IN_ONLY);
    return {
      async execute({ tx, workspaceId, actor }) {
        const now = new Date();
        let ended: {
          readonly memberId: string;
          readonly label: string;
          readonly scopes: readonly string[];
        };

        if (input.kind === "grant") {
          const [grant] = await tx
            .select({
              id: oauthGrants.id,
              memberId: oauthGrants.memberId,
              scopes: oauthGrants.scopes,
              clientName: oauthClients.name,
            })
            .from(oauthGrants)
            .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
            .where(
              activeOnly(
                oauthGrants,
                eq(oauthGrants.workspaceId, workspaceId),
                eq(oauthGrants.id, input.id),
                isNull(oauthGrants.revokedAt),
              ),
            )
            .limit(1);
          if (!grant) {
            throw new OperationError(
              "not_found",
              "No such connection, or it is already ended.",
            );
          }
          // An administrator ending their own keeps the member's sentence
          // (D5): "An administrator ended this" would read oddly to them.
          await revokeGrant(tx, {
            workspaceId,
            grantId: grant.id,
            reason: grant.memberId === actor.memberId ? "member" : "admin",
            now,
          });
          ended = {
            memberId: grant.memberId,
            label: grant.clientName,
            scopes: grant.scopes,
          };
        } else {
          // openokr:allow-mutation: the Operation's own transaction.
          const [token] = await tx
            .update(apiTokens)
            .set({ revokedAt: now, revokedReason: "admin", updatedAt: now })
            .where(
              activeOnly(
                apiTokens,
                eq(apiTokens.workspaceId, workspaceId),
                eq(apiTokens.id, input.id),
                eq(apiTokens.audience, "mcp"),
                isNull(apiTokens.revokedAt),
              ),
            )
            .returning({
              memberId: apiTokens.memberId,
              name: apiTokens.name,
              scopes: apiTokens.scopes,
            });
          if (!token) {
            throw new OperationError(
              "not_found",
              "No such agent token, or it is already ended.",
            );
          }
          ended = {
            memberId: token.memberId,
            label: token.name,
            scopes: token.scopes,
          };
        }

        // The member hears it (Akmal's Q1 answer), unless it was their own.
        if (ended.memberId !== actor.memberId) {
          await notifyRecipients(tx, {
            workspaceId,
            subjectType: "agent_connection",
            subjectId: input.id,
            recipients: [
              { memberId: ended.memberId, reason: "connection_ended" as const },
            ],
          });
        }

        return {
          result: { id: input.id },
          // Private (D6): it names a colleague and their tool.
          activity: {
            kind: "connection.ended_by_admin",
            subjectType: "workspace",
            subjectId: workspaceId,
            payload: {
              kind: input.kind,
              id: input.id,
              memberId: ended.memberId,
            },
          },
          audit: {
            action: "connections.revokeAsAdmin",
            targetType: input.kind === "grant" ? "oauth_grant" : "api_token",
            targetId: input.id,
            payload: {
              memberId: ended.memberId,
              clientName: ended.label,
              scopes: [...ended.scopes],
            },
          },
        };
      },
    };
  },
});
