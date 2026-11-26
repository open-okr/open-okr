/**
 * The FlowyTeam connection: connect, finish, disconnect and the card's read
 * (docs/design/flowyteam-connect.md §4.1, plan cards C3 and C4).
 *
 * **`full`, like every import action.** The token reads a whole company, and
 * connecting is the administrative act that lets this workspace load it (Q9).
 *
 * Preview and run (C4) record the run row and an outbox row in one
 * transaction; the job in `imports/flowyteam/job.ts` does the reading.
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
  importRuns,
  inviteLinks,
  withWorkspace,
  workspaceMembers,
} from "@openokr/db";
import { and, asc, desc, eq, gt, isNotNull, isNull, or } from "drizzle-orm";
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
import {
  backgroundJobsRun,
  FLOWYTEAM_IMPORT_TOPIC,
  restrictedKpisIn,
} from "../imports/flowyteam/job.ts";
import { flowyteamQueryCatalogue } from "../imports/flowyteam/queries.ts";
import { companyAlreadyImported } from "../imports/flowyteam/run.ts";
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
          "Connecting FlowyTeam is turned off on this instance. Import with the command line instead.",
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
// Preview and run (C4)
// ---------------------------------------------------------------------------

/** Refusal sentences. The card says them in its own words by `reason`. */
const FLOWYTEAM_IMPORT_MESSAGES = {
  background_off:
    "Background work is off on this instance, so a FlowyTeam import cannot run. Ask the operator to turn the scheduler on.",
  not_connected: "FlowyTeam is not connected.",
  revoked:
    "FlowyTeam no longer accepts this connection's access. Connect again from the import page.",
  other_company:
    "This workspace already holds another FlowyTeam company. A workspace holds one company.",
  already_running: "A FlowyTeam import is already running in this workspace.",
  visibility_not_accepted:
    "The preview named KPIs that will become visible to every member. Confirm that before importing.",
} as const;

type ImportRefusal = keyof typeof FLOWYTEAM_IMPORT_MESSAGES;

function importRefusal(
  code: "forbidden" | "not_found" | "conflict",
  reason: ImportRefusal,
): OperationError {
  return new OperationError(code, FLOWYTEAM_IMPORT_MESSAGES[reason], {
    reason,
  });
}

/** A run left `running` longer than this is not counted as one in progress. */
const RUNNING_WINDOW_MS = 2 * 60 * 60 * 1000;

function enqueueImport(write: boolean) {
  return (
    context: ActionCallContext,
    input: { readonly acceptBroaderVisibility?: boolean },
  ) => ({
    async execute({
      tx,
      workspaceId,
    }: {
      tx: OperationTx;
      workspaceId: string;
    }) {
      if (!backgroundJobsRun()) {
        throw importRefusal("forbidden", "background_off");
      }
      const connection = await liveConnection(tx, workspaceId);
      if (!connection) {
        throw importRefusal("not_found", "not_connected");
      }
      if (connection.revokedAt || !connection.tokenCiphertext) {
        throw importRefusal("forbidden", "revoked");
      }
      const companyId = Number(connection.companyId);

      const runs = await tx
        .select({
          source: importRuns.source,
          status: importRuns.status,
          mode: importRuns.mode,
          report: importRuns.report,
          startedAt: importRuns.startedAt,
        })
        .from(importRuns)
        .where(
          activeOnly(
            importRuns,
            eq(importRuns.workspaceId, workspaceId),
            eq(importRuns.source, FLOWYTEAM_SOURCE),
          ),
        )
        .orderBy(desc(importRuns.startedAt))
        .limit(100);
      const prior = runs.map((run) => ({
        source: run.source,
        status: run.status,
        report: (run.report ?? {}) as Record<string, unknown>,
      }));
      if (companyAlreadyImported(prior, companyId) !== null) {
        throw importRefusal("conflict", "other_company");
      }
      const since = Date.now() - RUNNING_WINDOW_MS;
      if (
        runs.some(
          (run) =>
            run.status === "running" &&
            (run.report as Record<string, unknown> | null)?.via === "export" &&
            run.startedAt.getTime() > since,
        )
      ) {
        throw importRefusal("conflict", "already_running");
      }
      if (write && input.acceptBroaderVisibility !== true) {
        const preview = runs.find(
          (run) =>
            run.mode === "dry_run" &&
            run.status === "completed" &&
            (run.report as Record<string, unknown> | null)?.companyId ===
              companyId,
        );
        if (
          preview &&
          restrictedKpisIn((preview.report ?? {}) as Record<string, unknown>) >
            0
        ) {
          throw importRefusal("forbidden", "visibility_not_accepted");
        }
      }

      const userId = context.actor.userId;
      const memberId = await actingMemberId(tx, workspaceId, userId);
      // openokr:allow-mutation: inside this operation's own transaction.
      const [run] = await tx
        .insert(importRuns)
        .values({
          workspaceId,
          source: FLOWYTEAM_SOURCE,
          entity: null,
          mode: write ? "real" : "dry_run",
          status: "running",
          filename: `FlowyTeam export: ${connection.companyName}`.slice(0, 400),
          report: { source: FLOWYTEAM_SOURCE, via: "export", companyId },
          requestedById: memberId,
        })
        .returning({ id: importRuns.id });
      if (!run || !userId) {
        throw new Error("The import run insert returned no row.");
      }
      const action = write
        ? "imports.flowyteamRun"
        : "imports.flowyteamPreview";
      return {
        result: { runId: run.id },
        audit: {
          action,
          targetType: "workspace",
          targetId: workspaceId,
          payload: {
            source: FLOWYTEAM_SOURCE,
            companyId: connection.companyId,
            runId: run.id,
            ...(write
              ? {
                  acceptBroaderVisibility:
                    input.acceptBroaderVisibility === true,
                }
              : {}),
          },
        },
        outbox: [
          {
            topic: FLOWYTEAM_IMPORT_TOPIC,
            // Identifiers only: the job opens the token from the row.
            payload: {
              workspaceId,
              connectionId: connection.id,
              runId: run.id,
              userId,
              write,
              acceptBroaderVisibility: input.acceptBroaderVisibility === true,
            },
            idempotencyKey: `${FLOWYTEAM_IMPORT_TOPIC}:${run.id}`,
          },
        ],
      };
    },
  });
}

export const flowyteamPreview = defineWriteAction({
  name: "imports.flowyteamPreview",
  agentSurface: false,
  summary:
    "Starts a dry run of the FlowyTeam import in the background. Writes nothing but the run's own row.",
  input: z.object({}),
  output: z.object({ runId: z.uuid() }),
  access: ACCESS_LEVELS.full,
  operation: (context, input) => enqueueImport(false)(context, input),
});

export const flowyteamRun = defineWriteAction({
  name: "imports.flowyteamRun",
  agentSurface: false,
  summary:
    "Starts the FlowyTeam import in the background. Adds what is new and changes nothing already imported.",
  input: z.object({
    /** Required when the latest preview named KPIs that will become more visible. */
    acceptBroaderVisibility: z.boolean().default(false),
  }),
  output: z.object({ runId: z.uuid() }),
  access: ACCESS_LEVELS.full,
  operation: (context, input) => enqueueImport(true)(context, input),
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
    /**
     * False when nothing on this instance runs background jobs, so preview
     * and import are refused (`background_off`).
     */
    backgroundWork: z.boolean(),
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
      backgroundWork: backgroundJobsRun(),
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

// ---------------------------------------------------------------------------
// The invite step (C5)
// ---------------------------------------------------------------------------

/**
 * The people a FlowyTeam import brought across with nobody behind them yet,
 * for the card's last step (flowyteam-connect Q6, AC 9).
 *
 * A row the importer wrote is a placeholder: no account, the person's address
 * in `placeholder_email`, waiting to be claimed when that person accepts an
 * invitation to it. `invited` says an unused personal invitation to that
 * address is still open, so the step does not offer to send a second one.
 *
 * **No last-active filter.** The catalogue reads no FlowyTeam sign-in date,
 * so the step lists everyone rather than guessing who is active.
 *
 * `full`, like every import action: the answer is a list of addresses.
 */
export const flowyteamPeople = defineReadAction({
  name: "imports.flowyteamPeople",
  agentSurface: false,
  summary:
    "The people a FlowyTeam import brought across who have no account yet, and whether each already has an open invitation.",
  input: z.object({}),
  output: z.object({
    people: z.array(
      z.object({
        memberId: z.uuid(),
        name: z.string(),
        title: z.string().nullable(),
        email: z.string(),
        invited: z.boolean(),
      }),
    ),
  }),
  access: ACCESS_LEVELS.full,
  async handler(context) {
    return withWorkspace(
      drizzle(context.pool),
      context.workspaceId,
      async (tx) => {
        const members = await tx
          .select({
            memberId: workspaceMembers.id,
            name: workspaceMembers.name,
            title: workspaceMembers.title,
            email: workspaceMembers.placeholderEmail,
          })
          .from(workspaceMembers)
          .where(
            activeOnly(
              workspaceMembers,
              eq(workspaceMembers.workspaceId, context.workspaceId),
              eq(workspaceMembers.legacyType, FLOWYTEAM_SOURCE),
              eq(workspaceMembers.kind, "placeholder"),
              eq(workspaceMembers.status, "active"),
              isNull(workspaceMembers.userId),
              isNotNull(workspaceMembers.placeholderEmail),
            ),
          )
          .orderBy(asc(workspaceMembers.name));
        const now = new Date();
        const open = await tx
          .select({ email: inviteLinks.email })
          .from(inviteLinks)
          .where(
            activeOnly(
              inviteLinks,
              eq(inviteLinks.workspaceId, context.workspaceId),
              eq(inviteLinks.mode, "personal"),
              isNull(inviteLinks.revokedAt),
              eq(inviteLinks.useCount, 0),
              or(isNull(inviteLinks.expiresAt), gt(inviteLinks.expiresAt, now)),
            ),
          );
        const invited = new Set(
          open.map((link) => (link.email ?? "").toLowerCase()),
        );
        return {
          people: members.map((member) => {
            const email = (member.email ?? "").toLowerCase();
            return {
              memberId: member.memberId,
              name: member.name,
              title: member.title,
              email,
              invited: invited.has(email),
            };
          }),
        };
      },
    );
  },
});
