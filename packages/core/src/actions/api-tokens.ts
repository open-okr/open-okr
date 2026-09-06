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
  deviceAuthorisations,
  TOKEN_AUDIENCES,
  TOKEN_SCOPES,
  type WorkspaceTx,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { desc, eq, gt, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { hashDeviceCode, pendingDevice } from "../api/device.ts";
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
export async function actingMemberId(
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

/**
 * The pending device request one code names, for the approval screen
 * (P5-T07c-b).
 *
 * A read rather than part of the approve write, because the screen has to say
 * what is being asked for *before* anybody presses a button. Null covers a code
 * that never existed, one that has expired and one already decided: three facts
 * somebody guessing codes has no business telling apart.
 */
export const readPendingDevice = defineReadAction({
  name: "tokens.pendingDevice",
  summary: "The terminal request one device code names, if it is still open.",
  input: z.object({ userCode: z.string().trim().min(4).max(32) }),
  output: z
    .object({
      id: z.uuid(),
      clientName: z.string(),
      requestedScopes: z.array(z.enum(TOKEN_SCOPES)),
      expiresAt: z.string(),
    })
    .nullable(),
  access: ACCESS_LEVELS.view,
  async handler(context, input) {
    return pendingDevice(context.pool, {
      userCode: input.userCode,
      now: new Date(),
    });
  },
});

/**
 * Approving or denying a terminal (P5-T07c-b).
 *
 * **It takes no scopes.** The row already says what the terminal asked for and
 * the screen shows it. Accepting a scope list here would be a path by which a
 * grant could become wider than the request, and the strongest way to close a
 * path is not to build it.
 *
 * **It carries the pre-tenant policy key.** The row it updates has no workspace
 * yet, so the tenant setting alone cannot see it; `deviceCodeHash` on the
 * operation spec puts `app.device_code_hash` on the pipeline's own transaction
 * for exactly this write.
 *
 * **Approving is the write that names the workspace.** A terminal does not
 * choose one; the member who approves does, by being in it.
 */
export const decideDevice = defineWriteAction({
  name: "tokens.approveDevice",
  summary: "Approve or deny a terminal that asked to sign in as you.",
  input: z.object({
    userCode: z.string().trim().min(4).max(32),
    approve: z.boolean(),
  }),
  output: z.object({ clientName: z.string(), approved: z.boolean() }),
  access: ACCESS_LEVELS.edit,
  operation: (_context, input) => ({
    deviceCodeHash: hashDeviceCode(input.userCode),
    async execute({ tx, workspaceId, actor }) {
      if (!actor.memberId) {
        throw new OperationError("forbidden", "No member to authorise as.");
      }
      const now = new Date();
      // openokr:allow-mutation: deciding the request is this action's whole
      // purpose, and it runs inside the Operation pipeline's transaction.
      const [row] = await tx
        .update(deviceAuthorisations)
        .set({
          workspaceId,
          approvedMemberId: input.approve ? actor.memberId : null,
          approvedAt: input.approve ? now : null,
          deniedAt: input.approve ? null : now,
          updatedAt: now,
        })
        .where(
          activeOnly(
            deviceAuthorisations,
            eq(
              deviceAuthorisations.userCodeHash,
              hashDeviceCode(input.userCode),
            ),
            // Undecided and still live. A decided row is not re-decidable and an
            // expired one is not decidable at all.
            isNull(deviceAuthorisations.approvedAt),
            isNull(deviceAuthorisations.deniedAt),
            gt(deviceAuthorisations.expiresAt, now),
          ),
        )
        .returning({
          id: deviceAuthorisations.id,
          clientName: deviceAuthorisations.clientName,
          requestedScopes: deviceAuthorisations.requestedScopes,
        });

      if (!row) {
        throw new OperationError(
          "not_found",
          "No such code, or it has expired or already been answered.",
        );
      }

      return {
        result: { clientName: row.clientName, approved: input.approve },
        activity: {
          kind: input.approve ? "device.approved" : "device.denied",
          subjectType: "device_authorisation",
          subjectId: row.id,
          // The name the terminal gave, snapshotted: the row is a ten-minute
          // artefact and the feed entry has to keep reading sensibly after it.
          payload: { clientName: row.clientName },
        },
        audit: {
          action: "tokens.approveDevice",
          targetType: "device_authorisation",
          targetId: row.id,
          payload: {
            clientName: row.clientName,
            approved: input.approve,
            scopes: row.requestedScopes,
          },
        },
      };
    },
  }),
});
