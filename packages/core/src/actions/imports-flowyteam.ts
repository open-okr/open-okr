/**
 * The FlowyTeam connection: connect, finish, disconnect and the card's read
 * (docs/design/flowyteam-connect.md §4.1, plan card C3). Preview and run are
 * C4's.
 *
 * **`full`, like every import action.** The token reads a whole company, and
 * connecting is the administrative act that lets this workspace load it (Q9).
 * FlowyTeam checks its own half: only a company admin may approve.
 *
 * **No action returns the token or anything sealed around it**, except the
 * state cookie `imports.flowyteamConnect` hands back for the browser to hold,
 * which carries the PKCE verifier and no credential. Audit rows name the
 * member, the source and the FlowyTeam company id, never the token.
 */
import {
  activeOnly,
  type ImportConnection,
  importConnections,
  withWorkspace,
} from "@openokr/db";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import {
  FLOWYTEAM_EXPORT_SCOPE,
  FLOWYTEAM_FAILURE_MESSAGES,
  FLOWYTEAM_REVOKE_TOPIC,
  FLOWYTEAM_SOURCE,
  FLOWYTEAM_STATE_MESSAGES,
  type FlowyteamAnswer,
  type FlowyteamStateRefusal,
  flowyteamAuthorizeUrl,
  flowyteamClientCredentials,
  flowyteamClientId,
  flowyteamRedirectUri,
  newConnectState,
  openConnectState,
  resolveFlowyteamSettings,
  sameState,
  sealConnectState,
} from "../imports/flowyteam/connection.ts";
import { flowyteamQueryCatalogue } from "../imports/flowyteam/queries.ts";
import { OperationError } from "../operations/errors.ts";
import { type OperationTx, runOperation } from "../operations/operation.ts";
import { encryptSecret, type KeyRing } from "../secrets/key-ring.ts";
import { actingMemberId } from "./api-tokens.ts";
import {
  type ActionCallContext,
  defineReadAction,
  defineWriteAction,
  requireDeclaredAccess,
} from "./define.ts";

function requireRing(context: ActionCallContext): KeyRing {
  if (!context.ring) {
    throw new Error(
      "This host built an ActionCallContext with no key ring, but reached a " +
        "FlowyTeam connection action that needs one to seal its state and token.",
    );
  }
  return context.ring;
}

function requireOrigin(context: ActionCallContext): string {
  if (!context.baseUrl) {
    throw new Error(
      "This host built an ActionCallContext with no base URL, so FlowyTeam " +
        "would have no address to send the administrator back to.",
    );
  }
  return context.baseUrl;
}

function stateRefusal(refusal: FlowyteamStateRefusal): OperationError {
  return new OperationError("forbidden", FLOWYTEAM_STATE_MESSAGES[refusal], {
    reason: refusal,
  });
}

/** A failed FlowyTeam answer as a refusal the card can say in its own words. */
function gatewayRefusal(
  answer: Extract<FlowyteamAnswer<unknown>, { ok: false }>,
): OperationError {
  return new OperationError(
    answer.failure === "version_mismatch" ? "conflict" : "forbidden",
    FLOWYTEAM_FAILURE_MESSAGES[answer.failure],
    { reason: answer.failure },
  );
}

/** The live row for this workspace, revoked or not. Disconnected rows are not live. */
async function liveConnection(
  tx: OperationTx,
  workspaceId: string,
): Promise<ImportConnection | undefined> {
  const [row] = await tx
    .select()
    .from(importConnections)
    .where(
      activeOnly(
        importConnections,
        eq(importConnections.workspaceId, workspaceId),
        eq(importConnections.source, FLOWYTEAM_SOURCE),
      ),
    )
    .limit(1);
  return row;
}

/** The outbox row that revokes a token at FlowyTeam once its row is closed. */
function revokeMessage(workspaceId: string, connectionId: string) {
  return {
    topic: FLOWYTEAM_REVOKE_TOPIC,
    // Identifiers only. The handler opens the token from the row, so the
    // outbox table never holds a credential.
    payload: { workspaceId, connectionId },
    idempotencyKey: `${FLOWYTEAM_REVOKE_TOPIC}:${connectionId}`,
  };
}

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------

export const flowyteamConnect = defineWriteAction({
  name: "imports.flowyteamConnect",
  agentSurface: false,
  summary:
    "Starts connecting FlowyTeam: the address to approve the connection at, and the sealed state the browser keeps for ten minutes.",
  input: z.object({}),
  output: z.object({
    authorizeUrl: z.string(),
    /** Sealed. The host sets it as an httpOnly cookie and nothing reads it but the callback. */
    stateCookie: z.string(),
    expiresAt: z.string(),
  }),
  access: ACCESS_LEVELS.full,
  operation: (context) => ({
    async execute({ workspaceId, actor }) {
      const ring = requireRing(context);
      const origin = requireOrigin(context);
      if (!actor.memberId) {
        throw new OperationError(
          "forbidden",
          "Only a member of this workspace can connect FlowyTeam.",
        );
      }
      const settings = await resolveFlowyteamSettings(context.pool);
      if (!settings.baseUrl) {
        throw new OperationError(
          "forbidden",
          "This instance has no FlowyTeam address. Import with the command line instead.",
          { reason: "not_configured" },
        );
      }
      const clientId = flowyteamClientId(settings, origin);
      const redirectUri = flowyteamRedirectUri(origin);
      const { state, challenge } = newConnectState({
        workspaceId,
        memberId: actor.memberId,
        baseUrl: settings.baseUrl,
        clientId,
        redirectUri,
        now: Date.now(),
      });
      return {
        result: {
          authorizeUrl: flowyteamAuthorizeUrl({
            baseUrl: settings.baseUrl,
            clientId,
            redirectUri,
            state: state.state,
            challenge,
          }),
          stateCookie: sealConnectState(ring, state),
          expiresAt: new Date(state.expiresAt).toISOString(),
        },
        audit: {
          action: "imports.flowyteamConnect",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { source: FLOWYTEAM_SOURCE, baseUrl: settings.baseUrl },
        },
      };
    },
  }),
});

// ---------------------------------------------------------------------------
// Finish (the callback)
// ---------------------------------------------------------------------------

const finishInput = z.object({
  code: z.string().trim().min(1).max(2000),
  state: z.string().trim().min(1).max(500),
  stateCookie: z.string().trim().min(1).max(8000),
});

const connectionView = z.object({
  companyId: z.string(),
  companyName: z.string(),
  baseUrl: z.string(),
  connectedAt: z.string(),
  connectedByMemberId: z.string(),
  lastReadAt: z.string().nullable(),
  /** `revoked` when FlowyTeam no longer accepts the token (AC 8). */
  state: z.enum(["connected", "revoked"]),
  revokedAt: z.string().nullable(),
});

/**
 * Finishes connecting once FlowyTeam sends the administrator back.
 *
 * **Declared by hand rather than through `defineWriteAction`**, because two
 * network calls come first and a transaction must not stay open across them.
 * The state is checked, the code exchanged and the company read; only then
 * does one Operation write the row, its audit and, when it replaces an older
 * connection, the outbox row that revokes the old token.
 */
export const flowyteamFinishConnect = {
  name: "imports.flowyteamFinishConnect" as const,
  agentSurface: false as const,
  summary:
    "Finishes connecting FlowyTeam with the code it returned, and stores the sealed connection.",
  input: finishInput,
  output: connectionView,
  access: ACCESS_LEVELS.full,
  safety: "write" as const,
  runsThroughPipeline: true,
  async handler(context: ActionCallContext, rawInput: unknown) {
    await requireDeclaredAccess(
      context,
      ACCESS_LEVELS.full,
      "imports.flowyteamFinishConnect",
    );
    const input = finishInput.parse(rawInput);
    const ring = requireRing(context);

    // Every check that needs no network first, so a refused callback never
    // spends the code at FlowyTeam.
    const opened = openConnectState(ring, input.stateCookie, Date.now());
    if (!opened.ok) {
      throw stateRefusal(opened.refusal);
    }
    const started = opened.state;
    if (!sameState(started.state, input.state)) {
      throw stateRefusal("state_mismatch");
    }
    if (started.workspaceId !== context.workspaceId) {
      throw stateRefusal("state_other_workspace");
    }
    const memberId = await withWorkspace(
      drizzle(context.pool),
      context.workspaceId,
      (tx) => actingMemberId(tx, context.workspaceId, context.actor.userId),
    );
    if (memberId !== started.memberId) {
      throw stateRefusal("state_other_member");
    }
    if (!context.flowyteam) {
      throw new OperationError(
        "forbidden",
        FLOWYTEAM_FAILURE_MESSAGES.unreachable,
        { reason: "unreachable" },
      );
    }

    const credentials = await flowyteamClientCredentials(
      context.pool,
      ring,
      started.clientId,
    );
    const exchanged = await context.flowyteam.exchangeCode({
      ...credentials,
      baseUrl: started.baseUrl,
      code: input.code,
      codeVerifier: started.verifier,
      redirectUri: started.redirectUri,
    });
    if (!exchanged.ok) {
      throw gatewayRefusal(exchanged);
    }
    const accessToken = exchanged.value.accessToken;
    const scopes = exchanged.value.scope.trim() || FLOWYTEAM_EXPORT_SCOPE;
    if (!scopes.split(/\s+/).includes(FLOWYTEAM_EXPORT_SCOPE)) {
      throw new OperationError(
        "forbidden",
        "FlowyTeam granted a different access than an import needs. Connect again.",
        { reason: "wrong_scope" },
      );
    }

    const company = await context.flowyteam.readCompany({
      baseUrl: started.baseUrl,
      accessToken,
      version: flowyteamQueryCatalogue().version,
    });
    if (!company.ok) {
      throw gatewayRefusal(company);
    }

    const sealed = encryptSecret(ring, accessToken);
    return runOperation(
      { pool: context.pool },
      {
        action: "imports.flowyteamFinishConnect",
        workspaceId: context.workspaceId,
        actor: context.actor,
        requires: ACCESS_LEVELS.full,
        ...(context.channel ? { channel: context.channel } : {}),
        async execute({ tx, workspaceId, actor }) {
          if (actor.memberId !== started.memberId) {
            throw stateRefusal("state_other_member");
          }
          const now = new Date();
          const previous = await liveConnection(tx, workspaceId);
          if (previous) {
            // openokr:allow-mutation: inside this operation's own transaction.
            await tx
              .update(importConnections)
              .set({
                deletedAt: now,
                revokedAt: previous.revokedAt ?? now,
                updatedAt: now,
              })
              .where(
                activeOnly(
                  importConnections,
                  eq(importConnections.id, previous.id),
                ),
              );
          }
          // openokr:allow-mutation: same reason as the update above.
          const [row] = await tx
            .insert(importConnections)
            .values({
              workspaceId,
              source: FLOWYTEAM_SOURCE,
              baseUrl: started.baseUrl,
              clientId: started.clientId,
              companyId: company.value.companyId,
              companyName: company.value.companyName,
              tokenCiphertext: sealed.ciphertext,
              tokenDataKey: sealed.dataKey,
              tokenKeyId: sealed.keyId,
              scopes,
              connectedByMemberId: started.memberId,
              connectedAt: now,
            })
            .returning();
          if (!row) {
            throw new Error("The connection insert returned no row.");
          }
          return {
            result: viewOf(row),
            audit: {
              action: "imports.flowyteamFinishConnect",
              targetType: "workspace",
              targetId: workspaceId,
              // The company, never the token. This row is append-only and
              // read by people.
              payload: {
                source: FLOWYTEAM_SOURCE,
                companyId: row.companyId,
                baseUrl: row.baseUrl,
                ...(previous ? { replacedCompanyId: previous.companyId } : {}),
              },
            },
            ...(previous?.tokenCiphertext
              ? { outbox: [revokeMessage(workspaceId, previous.id)] }
              : {}),
          };
        },
      },
    );
  },
};

function viewOf(row: ImportConnection): z.infer<typeof connectionView> {
  return {
    companyId: row.companyId,
    companyName: row.companyName,
    baseUrl: row.baseUrl,
    connectedAt: row.connectedAt.toISOString(),
    connectedByMemberId: row.connectedByMemberId,
    lastReadAt: row.lastReadAt?.toISOString() ?? null,
    state: row.revokedAt ? "revoked" : "connected",
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

export const flowyteamDisconnect = defineWriteAction({
  name: "imports.flowyteamDisconnect",
  agentSurface: false,
  summary:
    "Disconnects FlowyTeam and revokes its token there when it can be reached. Imported data stays.",
  input: z.object({}),
  output: z.object({ companyId: z.string() }),
  access: ACCESS_LEVELS.full,
  safety: "destructive",
  operation: () => ({
    async execute({ tx, workspaceId }) {
      const existing = await liveConnection(tx, workspaceId);
      if (!existing) {
        throw new OperationError("not_found", "FlowyTeam is not connected.");
      }
      const now = new Date();
      // Soft-deleted with the token still sealed in it: the relay opens it
      // once to revoke it at FlowyTeam and then clears it. Imported rows and
      // their legacy ids are untouched, so the one-company rule still holds.
      // openokr:allow-mutation: inside this operation's own transaction.
      await tx
        .update(importConnections)
        .set({
          deletedAt: now,
          revokedAt: existing.revokedAt ?? now,
          updatedAt: now,
        })
        .where(
          activeOnly(importConnections, eq(importConnections.id, existing.id)),
        );
      return {
        result: { companyId: existing.companyId },
        audit: {
          action: "imports.flowyteamDisconnect",
          targetType: "workspace",
          targetId: workspaceId,
          payload: { source: FLOWYTEAM_SOURCE, companyId: existing.companyId },
        },
        ...(existing.tokenCiphertext
          ? { outbox: [revokeMessage(workspaceId, existing.id)] }
          : {}),
      };
    },
  }),
});

// ---------------------------------------------------------------------------
// The card's read
// ---------------------------------------------------------------------------

export const flowyteamConnection = defineReadAction({
  name: "imports.flowyteamConnection",
  agentSurface: false,
  summary:
    "Whether this instance offers connecting FlowyTeam, and this workspace's connection if it has one. Never the token.",
  input: z.object({}),
  output: z.object({
    /** False when this instance has no FlowyTeam address: the card points at the command line. */
    available: z.boolean(),
    connection: connectionView.nullable(),
  }),
  access: ACCESS_LEVELS.full,
  async handler(context) {
    const settings = await resolveFlowyteamSettings(context.pool);
    const row = await withWorkspace(
      drizzle(context.pool),
      context.workspaceId,
      async (tx) => {
        // Declared columns only, so a sealed column added later cannot leak
        // through this read.
        const [found] = await tx
          .select({
            companyId: importConnections.companyId,
            companyName: importConnections.companyName,
            baseUrl: importConnections.baseUrl,
            connectedAt: importConnections.connectedAt,
            connectedByMemberId: importConnections.connectedByMemberId,
            lastReadAt: importConnections.lastReadAt,
            revokedAt: importConnections.revokedAt,
          })
          .from(importConnections)
          .where(
            activeOnly(
              importConnections,
              and(
                eq(importConnections.workspaceId, context.workspaceId),
                eq(importConnections.source, FLOWYTEAM_SOURCE),
              ),
            ),
          )
          .orderBy(desc(importConnections.connectedAt))
          .limit(1);
        return found;
      },
    );
    return {
      available: settings.baseUrl !== null,
      connection: row
        ? {
            companyId: row.companyId,
            companyName: row.companyName,
            baseUrl: row.baseUrl,
            connectedAt: row.connectedAt.toISOString(),
            connectedByMemberId: row.connectedByMemberId,
            lastReadAt: row.lastReadAt?.toISOString() ?? null,
            state: row.revokedAt
              ? ("revoked" as const)
              : ("connected" as const),
            revokedAt: row.revokedAt?.toISOString() ?? null,
          }
        : null,
    };
  },
});
