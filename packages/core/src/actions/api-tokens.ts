/**
 * Minting, listing and revoking API tokens (§14, P5-T07a).
 *
 * **A token is personal.** Each one belongs to the member who minted it and
 * carries their authority, narrowed by its scopes. Nobody can mint a token for
 * somebody else, and nobody can see anybody else's list. That is why these read
 * and write the acting member's own rows and take no member id: an action that
 * accepted one would be an action somebody could aim at a colleague.
 *
 * **The raw token exists for one response.** `create` returns it, once, and
 * nothing in the product can produce it again. Everything else works from the
 * digest.
 *
 * **Revoking is not deleting.** The row stays, marked, so the list can say "you
 * revoked that one on Tuesday" instead of quietly losing it. A person debugging
 * a service that stopped working needs to see that.
 */
import {
  activeOnly,
  apiTokens,
  TOKEN_AUDIENCES,
  TOKEN_SCOPES,
  type WorkspaceTx,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { desc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { mintApiToken } from "../api/tokens.ts";
import { OperationError } from "../operations/operation.ts";
import { defineReadAction, defineWriteAction } from "./define.ts";

/** What a list shows. Never the token, and never a hash. */
const tokenSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  audience: z.enum(TOKEN_AUDIENCES),
  prefix: z.string(),
  scopes: z.array(z.enum(TOKEN_SCOPES)),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});

const iso = (value: Date | null): string | null =>
  value ? value.toISOString() : null;

/** The acting member, or a refusal. Every action here is about them. */
async function actingMemberId(
  tx: WorkspaceTx,
  workspaceId: string,
  userId: string | undefined,
): Promise<string> {
  if (!userId) {
    throw new OperationError("not_found", "No such workspace.");
  }
  const [member] = await tx
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      activeOnly(
        workspaceMembers,
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, "active"),
      ),
    )
    .limit(1);
  if (!member) {
    throw new OperationError(
      "not_found",
      "No such workspace, or you are not a member of it.",
    );
  }
  return member.id;
}

export const listMyTokens = defineReadAction({
  name: "tokens.mine",
  summary: "The signed-in member's own API tokens, newest first.",
  input: z.object({}),
  output: z.object({ tokens: z.array(tokenSummary) }),
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
        .select()
        .from(apiTokens)
        .where(
          activeOnly(
            apiTokens,
            eq(apiTokens.workspaceId, context.workspaceId),
            eq(apiTokens.memberId, memberId),
          ),
        )
        .orderBy(desc(apiTokens.createdAt));
      return {
        tokens: rows.map((row) => ({
          id: row.id,
          name: row.name,
          audience: row.audience,
          prefix: row.prefix,
          scopes: row.scopes,
          expiresAt: iso(row.expiresAt),
          lastUsedAt: iso(row.lastUsedAt),
          revokedAt: iso(row.revokedAt),
          createdAt: row.createdAt.toISOString(),
        })),
      };
    });
  },
});

export const createApiToken = defineWriteAction({
  name: "tokens.create",
  summary: "Mint an API token, shown once, carrying your own authority.",
  input: z.object({
    name: z.string().trim().min(1).max(120),
    audience: z.enum(TOKEN_AUDIENCES).default("rest"),
    /**
     * At least one. A token with no scopes could reach nothing, which is a
     * confusing thing to have minted rather than a safe one.
     */
    scopes: z.array(z.enum(TOKEN_SCOPES)).min(1),
    /**
     * Null means it does not expire on its own. An expiry is offered in days
     * rather than as a date so a form does not need a calendar and a script
     * does not need to compute one.
     */
    expiresInDays: z.number().int().min(1).max(3650).nullable().default(null),
  }),
  output: z.object({
    id: z.uuid(),
    /** The only time this is ever returned. */
    token: z.string(),
    prefix: z.string(),
  }),
  // A write, so at least edit, which every active member holds on the
  // workspace's own context. The token cannot exceed what the member can
  // already do, so nothing here is an escalation.
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      if (!actor.memberId) {
        throw new OperationError("forbidden", "No member to mint a token for.");
      }
      const minted = mintApiToken(input.audience);
      const now = new Date();
      const expiresAt =
        input.expiresInDays === null
          ? null
          : new Date(now.getTime() + input.expiresInDays * 86_400_000);

      const [row] = await tx
        .insert(apiTokens)
        .values({
          workspaceId,
          memberId: actor.memberId,
          name: input.name,
          audience: input.audience,
          tokenHash: minted.hash,
          prefix: minted.prefix,
          scopes: [...input.scopes],
          expiresAt,
        })
        .returning({ id: apiTokens.id });
      if (!row) {
        throw new OperationError("not_found", "Could not mint that token.");
      }

      return {
        result: { id: row.id, token: minted.raw, prefix: minted.prefix },
        activity: {
          kind: "api_token.created",
          subjectType: "api_token",
          subjectId: row.id,
          // The name and audience, not the prefix: a feed entry says which
          // token this was without being a step towards presenting it.
          payload: { name: input.name, audience: input.audience },
        },
        audit: {
          action: "tokens.create",
          targetType: "api_token",
          targetId: row.id,
          payload: { audience: input.audience, scopes: input.scopes },
        },
      };
    },
  }),
});

export const revokeApiToken = defineWriteAction({
  name: "tokens.revoke",
  summary: "Revoke one of your own API tokens.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.uuid(), name: z.string() }),
  access: ACCESS_LEVELS.edit,
  // Destructive: it takes away a capability something is currently using, and
  // there is no undo. A scope for that is the point of having three.
  safety: "destructive",
  operation: (_context, input) => ({
    async execute({ tx, workspaceId, actor }) {
      if (!actor.memberId) {
        throw new OperationError("forbidden", "No member.");
      }
      // openokr:allow-mutation: revoking is this action's whole purpose and it
      // runs inside the Operation pipeline's transaction.
      const [row] = await tx
        .update(apiTokens)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(
          activeOnly(
            apiTokens,
            eq(apiTokens.workspaceId, workspaceId),
            eq(apiTokens.id, input.id),
            // Your own, and only your own. Somebody else's token is not
            // yours to revoke, and this returns not-found rather than
            // refusing, so a probe learns nothing about which ids exist.
            eq(apiTokens.memberId, actor.memberId),
            isNull(apiTokens.revokedAt),
          ),
        )
        .returning({ id: apiTokens.id, name: apiTokens.name });
      if (!row) {
        throw new OperationError(
          "not_found",
          "No such token, or it is already revoked.",
        );
      }

      return {
        result: row,
        activity: {
          kind: "api_token.revoked",
          subjectType: "api_token",
          subjectId: row.id,
          payload: { name: row.name },
        },
        audit: {
          action: "tokens.revoke",
          targetType: "api_token",
          targetId: row.id,
        },
      };
    },
  }),
});
