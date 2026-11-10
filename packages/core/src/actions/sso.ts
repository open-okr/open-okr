/**
 * A workspace's single sign-on connections, read, changed, turned off and
 * removed (S-36).
 *
 * **The admin screen could add a connection and do nothing else.** Correcting
 * a client id, rotating a client secret, taking a misbehaving provider off the
 * sign-in page or retiring one all meant somebody running SQL on
 * `sso_connections`. These four actions are what replace that.
 *
 * **Adding one is `sso.createConnection`**, which `POST /api/v1/admin/sso`
 * calls. It runs through the pipeline like the others, so adding a provider
 * leaves an audit row naming the actor.
 *
 * **A change reaches every process without a restart** (completeness review
 * L-15). Each process watches a stamp of the enabled, not-deleted rows and
 * reloads when it moves, so an edit, a switch and a removal each move it. The
 * SAML plugin's derived row is written inside the same transaction as the
 * change it follows, so the next sign-in on the saving process meets the new
 * settings rather than waiting for its reload to put the row right.
 *
 * **The client secret goes one way.** It is sealed under the key ring on the
 * way in and never read back out: the list carries no secret, and an edit that
 * leaves the secret blank keeps the one already stored.
 */
import {
  activeOnly,
  type SSOConnection,
  ssoConnections,
  withWorkspace,
} from "@openokr/db";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { removeSamlProvider, writeSamlProvider } from "../auth/saml-sync.ts";
import {
  assertDomainsVerified,
  type CreateSSOConnectionInput,
  derivedProviderId,
  normaliseCertificate,
  SSOConnectionRejected,
  type SSOProviderConfig,
  splitDomains,
  validateSSOConnectionInput,
} from "../auth/sso.ts";
import { OperationError, type OperationTx } from "../operations/operation.ts";
import { encryptSecret, type KeyRing } from "../secrets/key-ring.ts";
import { isCloudEnabled } from "../tenancy/settings.ts";
import {
  type ActionCallContext,
  defineReadAction,
  defineWriteAction,
} from "./define.ts";

function requireRing(context: ActionCallContext): KeyRing {
  if (!context.ring) {
    throw new Error(
      "This host built an ActionCallContext with no key ring, but reached " +
        "an action that needs one to seal a client secret.",
    );
  }
  return context.ring;
}

/** What an administrator may see of a connection. Everything but the secret. */
const connectionOutput = z.object({
  id: z.string(),
  kind: z.enum(["oidc", "saml"]),
  /** The slug the administrator chose. Read-only once saved. */
  providerId: z.string(),
  /**
   * What Better Auth knows the connection by, and what its callback address
   * and a SAML provider's service-provider addresses carry.
   */
  signInId: z.string(),
  displayName: z.string(),
  emailDomains: z.string(),
  enforce: z.boolean(),
  enabled: z.boolean(),
  /** Null for SAML, which has no client. */
  clientId: z.string().nullable(),
  discoveryUrl: z.string().nullable(),
  authorizationUrl: z.string().nullable(),
  tokenUrl: z.string().nullable(),
  userInfoUrl: z.string().nullable(),
  scopes: z.string(),
  samlEntryPoint: z.string().nullable(),
  samlIssuer: z.string().nullable(),
  /** A public key, so it is shown. See migration 0096. */
  samlCertificate: z.string().nullable(),
  samlAudience: z.string().nullable(),
});

export type SSOConnectionDetails = z.infer<typeof connectionOutput>;

type Kind = SSOConnectionDetails["kind"];

const kindOf = (row: Pick<SSOConnection, "kind">): Kind =>
  row.kind === "saml" ? "saml" : "oidc";

/**
 * The columns the list selects. The three secret columns are not among them,
 * so a sealed secret never leaves the database on a read.
 */
const DETAIL_COLUMNS = {
  id: ssoConnections.id,
  workspaceId: ssoConnections.workspaceId,
  kind: ssoConnections.kind,
  providerId: ssoConnections.providerId,
  displayName: ssoConnections.displayName,
  emailDomains: ssoConnections.emailDomains,
  enforce: ssoConnections.enforce,
  enabled: ssoConnections.enabled,
  clientId: ssoConnections.clientId,
  discoveryUrl: ssoConnections.discoveryUrl,
  authorizationUrl: ssoConnections.authorizationUrl,
  tokenUrl: ssoConnections.tokenUrl,
  userInfoUrl: ssoConnections.userInfoUrl,
  scopes: ssoConnections.scopes,
  samlEntryPoint: ssoConnections.samlEntryPoint,
  samlIssuer: ssoConnections.samlIssuer,
  samlCertificate: ssoConnections.samlCertificate,
  samlAudience: ssoConnections.samlAudience,
} as const;

type DetailRow = Pick<SSOConnection, keyof typeof DETAIL_COLUMNS>;

function toDetails(row: DetailRow): SSOConnectionDetails {
  const kind = kindOf(row);
  return {
    id: row.id,
    kind,
    providerId: row.providerId,
    signInId: derivedProviderId(row.providerId, row.workspaceId),
    displayName: row.displayName,
    emailDomains: row.emailDomains,
    enforce: row.enforce,
    enabled: row.enabled,
    // A SAML row carries a placeholder here because 0091 says not null.
    clientId: kind === "saml" ? null : row.clientId,
    discoveryUrl: row.discoveryUrl,
    authorizationUrl: row.authorizationUrl,
    tokenUrl: row.tokenUrl,
    userInfoUrl: row.userInfoUrl,
    scopes: row.scopes,
    samlEntryPoint: row.samlEntryPoint,
    samlIssuer: row.samlIssuer,
    samlCertificate: row.samlCertificate,
    samlAudience: row.samlAudience,
  };
}

/**
 * Keeps the SAML plugin's derived row in step with one connection, inside the
 * transaction that changed it.
 *
 * A connection that is off, removed or not SAML has no derived row. One that
 * is on has one, written from the row as stored. **The instance's own address
 * is needed to write it**, and a host that did not pass one leaves the row to
 * the reload every process runs within seconds of the stamp moving, which
 * writes it from the same table. Removing needs no address, so a removal
 * never waits.
 */
async function keepPluginInStep(
  tx: OperationTx,
  row: SSOConnection,
  baseUrl: string | undefined,
): Promise<void> {
  const providerId = derivedProviderId(row.providerId, row.workspaceId);
  if (kindOf(row) !== "saml" || !row.enabled || row.deletedAt !== null) {
    await removeSamlProvider(tx, providerId);
    return;
  }
  if (baseUrl === undefined) {
    return;
  }
  const connection: SSOProviderConfig = {
    kind: "saml",
    id: row.id,
    providerId,
    displayName: row.displayName,
    workspaceId: row.workspaceId,
    clientId: "",
    clientSecret: "",
    scopes: [],
    emailDomains: row.emailDomains
      .split(",")
      .map((one) => one.trim().toLowerCase())
      .filter(Boolean),
    enforce: row.enforce,
    ...(row.samlEntryPoint ? { samlEntryPoint: row.samlEntryPoint } : {}),
    ...(row.samlIssuer ? { samlIssuer: row.samlIssuer } : {}),
    ...(row.samlCertificate ? { samlCertificate: row.samlCertificate } : {}),
    ...(row.samlAudience ? { samlAudience: row.samlAudience } : {}),
    samlWantAssertionsSigned: row.samlWantAssertionsSigned,
  };
  await writeSamlProvider(tx, connection, baseUrl);
}

/** The connection this workspace holds under `id`, or not-found. */
async function loadConnection(
  tx: OperationTx,
  workspaceId: string,
  id: string,
): Promise<SSOConnection> {
  const [row] = await tx
    .select()
    .from(ssoConnections)
    .where(
      activeOnly(
        ssoConnections,
        // The floor and the predicate both, so neither is the only thing
        // standing between one workspace and another's configuration. Another
        // workspace's id answers exactly as an id that never existed does.
        eq(ssoConnections.workspaceId, workspaceId),
        eq(ssoConnections.id, id),
      ),
    )
    .limit(1);
  if (!row) {
    throw new OperationError(
      "not_found",
      "No such single sign-on connection in this workspace.",
    );
  }
  return row;
}

/** An optional text field an edit may clear by sending null or "". */
const clearable = z.string().nullable().optional();

/**
 * The addresses this server itself fetches from the provider: the discovery
 * document, the token endpoint and the user-info endpoint. The authorisation
 * address is where the browser is sent, so the server never calls it.
 */
const SERVER_FETCHED = ["discoveryUrl", "tokenUrl", "userInfoUrl"] as const;

/**
 * Refuses a provider address the outbound guard would not let this server
 * fetch, at the moment somebody can still fix it (docs/design/
 * hardening-batch-2026-11.md H-C).
 *
 * Only an address that is new or changed is checked, so editing a display
 * name never waits on a name server and never fails over an address saved
 * before this check existed. A private address is accepted on a self-hosted
 * instance, where the identity provider is often inside the network, and
 * refused on the managed cloud, where the administrator is not the operator.
 * The cloud metadata addresses are refused everywhere.
 *
 * **This is the save-time half.** Better Auth fetches the discovery document
 * and the user-info endpoint with its own client and takes no custom `fetch`,
 * so a name that changes its answer after saving is not caught at sign-in.
 */
async function refuseUnsafeAddresses(
  context: ActionCallContext,
  next: Partial<Record<(typeof SERVER_FETCHED)[number], string | null>>,
  stored: Partial<Record<(typeof SERVER_FETCHED)[number], string | null>> = {},
): Promise<void> {
  const changed = SERVER_FETCHED.filter((field) => {
    const value = next[field];
    return said(value) && value !== stored[field];
  });
  if (changed.length === 0) {
    return;
  }
  if (!context.checkOutboundUrl) {
    throw new Error(
      "This host built an ActionCallContext with no outbound check, but reached " +
        "a single sign-on action that stores an address this server will fetch.",
    );
  }
  const allowPrivate = !(await isCloudEnabled(context.pool));
  for (const field of changed) {
    const checked = await context.checkOutboundUrl(next[field] as string, {
      allowPrivate,
    });
    if (!checked.ok) {
      throw new SSOConnectionRejected({ field, message: checked.detail });
    }
  }
}

const createInput = z.object({
  kind: z.enum(["oidc", "saml"]).optional(),
  providerId: z.string(),
  displayName: z.string(),
  clientId: z.string().optional(),
  /** Sealed on the way in and never read back out. */
  clientSecret: z.string().optional(),
  discoveryUrl: clearable,
  authorizationUrl: clearable,
  tokenUrl: clearable,
  userInfoUrl: clearable,
  scopes: z.string().optional(),
  emailDomains: z.string().optional(),
  enforce: z.boolean().optional(),
  samlEntryPoint: clearable,
  samlIssuer: clearable,
  samlCertificate: clearable,
  samlAudience: clearable,
});

/**
 * Adds a connection for a workspace, whichever protocol it speaks.
 *
 * **This exists because the route that used to do it could never work**
 * (audit, 18 September 2026): it asked the database for the workspace with
 * `current_setting` on a bare pool, which raises, so no provider could be
 * configured on any instance. It then lived outside the pipeline and wrote no
 * audit row. Both are fixed by being an action: the workspace comes from the
 * call, and the change, the activity and the audit row commit together.
 *
 * **A SAML row's derived provider row is written in the same transaction**
 * (P8-T07c-b), so a provider configured today works at the next sign-in
 * rather than after somebody notices (L-15).
 *
 * The audit payload names the provider and the protocol. It never carries a
 * secret, a certificate or an address.
 */
export const createSSOConnectionAction = defineWriteAction({
  name: "sso.createConnection",
  agentSurface: false,
  summary:
    "Adds a single sign-on connection, OIDC or SAML, to this workspace. The client secret is sealed on the way in and never shown again.",
  input: createInput,
  output: z.object({ id: z.string(), providerId: z.string() }),
  access: ACCESS_LEVELS.full,
  operation: (context, input) => ({
    async execute({ tx, workspaceId }) {
      const given = input as CreateSSOConnectionInput;
      const problem = validateSSOConnectionInput(given);
      if (problem) {
        throw new SSOConnectionRejected(problem);
      }
      await refuseUnsafeAddresses(context, given);

      const kind = given.kind === "saml" ? "saml" : "oidc";
      // A SAML provider has no client secret. The three secret columns are
      // not null from 0091, so an empty one is sealed and stored: nothing
      // reads it, and making them nullable would mean every OIDC read had to
      // handle a null only SAML can produce.
      const sealed = encryptSecret(
        requireRing(context),
        given.clientSecret ?? "",
      );
      const certificate =
        kind === "saml"
          ? normaliseCertificate(given.samlCertificate ?? "")
          : null;

      // Rule 3 of docs/design/sso-domain-verification.md: a new connection
      // enforces only domains this workspace has verified.
      if (given.enforce) {
        await assertDomainsVerified(
          tx,
          workspaceId,
          splitDomains(given.emailDomains ?? ""),
        );
      }

      let row: SSOConnection | undefined;
      try {
        // openokr:allow-mutation: this is the operation's own execute, on the
        // transaction runOperation opened. The change, the activity and the
        // audit row commit together.
        [row] = await tx
          .insert(ssoConnections)
          .values({
            workspaceId,
            kind,
            providerId: given.providerId,
            displayName: given.displayName,
            discoveryUrl: given.discoveryUrl ?? null,
            authorizationUrl: given.authorizationUrl ?? null,
            tokenUrl: given.tokenUrl ?? null,
            userInfoUrl: given.userInfoUrl ?? null,
            clientId: given.clientId ?? "",
            secretCiphertext: sealed.ciphertext,
            secretDataKey: sealed.dataKey,
            secretKeyId: sealed.keyId,
            scopes: given.scopes ?? "openid email profile",
            emailDomains: given.emailDomains ?? "",
            enforce: given.enforce ?? false,
            samlEntryPoint: given.samlEntryPoint ?? null,
            samlIssuer: given.samlIssuer ?? null,
            samlCertificate: certificate,
            samlAudience: given.samlAudience ?? null,
          })
          .returning();
      } catch (error) {
        // The unique index on (workspace, provider ID). The driver wraps the
        // database's message, so the constraint name may be on the cause.
        const text = `${error instanceof Error ? error.message : ""} ${
          error instanceof Error && error.cause instanceof Error
            ? error.cause.message
            : ""
        }`;
        if (text.includes("sso_connections_provider")) {
          throw new OperationError(
            "conflict",
            "A provider with that ID already exists in this workspace",
            undefined,
            "providerId",
          );
        }
        throw error;
      }
      if (!row) {
        throw new Error("The SSO connection insert returned no row");
      }
      await keepPluginInStep(tx, row, context.baseUrl);

      return {
        result: {
          id: row.id,
          providerId: derivedProviderId(row.providerId, workspaceId),
        },
        activity: {
          kind: "sso.connection_created",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { name: row.displayName },
        },
        audit: {
          action: "sso.createConnection",
          targetType: "sso_connection",
          targetId: row.id,
          payload: { providerId: row.providerId, protocol: kind },
        },
      };
    },
  }),
});

export const listSSOConnections = defineReadAction({
  name: "sso.listConnections",
  summary:
    "This workspace's single sign-on connections, turned-off ones included, with every setting except the client secret.",
  input: z.object({}),
  output: z.array(connectionOutput),
  // Which identity provider a workspace trusts, and for which addresses, is
  // administration. The S-36 layout refuses below `full`, and so does this.
  access: ACCESS_LEVELS.full,
  async handler(context) {
    const db = drizzle(context.pool);
    return withWorkspace(db, context.workspaceId, async (tx) => {
      const rows = await tx
        .select(DETAIL_COLUMNS)
        .from(ssoConnections)
        .where(
          activeOnly(
            ssoConnections,
            eq(ssoConnections.workspaceId, context.workspaceId),
          ),
        )
        .orderBy(asc(ssoConnections.displayName), asc(ssoConnections.id));
      return rows.map(toDetails);
    });
  },
});

/** Which fields belong to which protocol, for refusing the other one's. */
const OIDC_ONLY = [
  "clientId",
  "clientSecret",
  "discoveryUrl",
  "authorizationUrl",
  "tokenUrl",
  "userInfoUrl",
  "scopes",
] as const;
const SAML_ONLY = [
  "samlEntryPoint",
  "samlIssuer",
  "samlCertificate",
  "samlAudience",
] as const;

const updateInput = z.object({
  id: z.uuid(),
  displayName: z.string().optional(),
  emailDomains: z.string().optional(),
  enforce: z.boolean().optional(),
  clientId: z.string().optional(),
  /** Blank or absent keeps the stored secret. */
  clientSecret: z.string().optional(),
  discoveryUrl: clearable,
  authorizationUrl: clearable,
  tokenUrl: clearable,
  userInfoUrl: clearable,
  scopes: z.string().optional(),
  samlEntryPoint: clearable,
  samlIssuer: clearable,
  samlCertificate: clearable,
  samlAudience: clearable,
});

type UpdateInput = z.infer<typeof updateInput>;

/** An input value that says something, as opposed to absent, null or blank. */
const said = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim() !== "";

/** The stored value, or what the edit replaced it with. "" clears it. */
const nextOf = (
  given: string | null | undefined,
  stored: string | null,
): string | null =>
  given === undefined ? stored : given === null ? null : given.trim() || null;

export const updateSSOConnection = defineWriteAction({
  name: "sso.updateConnection",
  summary:
    "Changes a single sign-on connection's name, email domains, enforcement and protocol settings. A blank client secret keeps the stored one.",
  input: updateInput,
  output: connectionOutput,
  access: ACCESS_LEVELS.full,
  operation: (context, input: UpdateInput) => ({
    load: ({ tx, workspaceId }) => loadConnection(tx, workspaceId, input.id),
    async execute({ tx, workspaceId, loaded }) {
      const kind = kindOf(loaded);

      // **The protocol and the provider ID stay as they are.** The provider ID
      // is in the callback address the identity provider already holds, and
      // changing the protocol would mean a different set of fields altogether.
      // Both are a new connection. A field of the other protocol is refused
      // rather than dropped, so an API caller is not told a change was saved
      // when it was not.
      const foreign = (kind === "saml" ? OIDC_ONLY : SAML_ONLY).find((field) =>
        said(input[field]),
      );
      if (foreign) {
        throw new SSOConnectionRejected({
          field: foreign,
          message:
            `This connection speaks ${kind === "saml" ? "SAML 2.0" : "OIDC"}, ` +
            `and ${foreign} belongs to the other protocol. The protocol of a ` +
            "connection cannot be changed: add a new connection instead.",
        });
      }

      const next = {
        displayName: (input.displayName ?? loaded.displayName).trim(),
        emailDomains: (input.emailDomains ?? loaded.emailDomains).trim(),
        enforce: input.enforce ?? loaded.enforce,
        clientId:
          kind === "saml"
            ? loaded.clientId
            : (input.clientId ?? loaded.clientId).trim(),
        discoveryUrl: nextOf(input.discoveryUrl, loaded.discoveryUrl),
        authorizationUrl: nextOf(
          input.authorizationUrl,
          loaded.authorizationUrl,
        ),
        tokenUrl: nextOf(input.tokenUrl, loaded.tokenUrl),
        userInfoUrl: nextOf(input.userInfoUrl, loaded.userInfoUrl),
        // Blank means the default, which is what the add form sends too.
        scopes:
          input.scopes === undefined
            ? loaded.scopes
            : input.scopes.trim() || "openid email profile",
        samlEntryPoint: nextOf(input.samlEntryPoint, loaded.samlEntryPoint),
        samlIssuer: nextOf(input.samlIssuer, loaded.samlIssuer),
        samlCertificate: nextOf(input.samlCertificate, loaded.samlCertificate),
        samlAudience: nextOf(input.samlAudience, loaded.samlAudience),
      };
      const secret = said(input.clientSecret) ? input.clientSecret : undefined;

      // **The one validator the add form uses**, on the connection as it
      // would be stored, so the two cannot disagree about what is allowed.
      const asStored: CreateSSOConnectionInput = {
        kind,
        providerId: loaded.providerId,
        ...next,
        ...(secret === undefined ? {} : { clientSecret: secret }),
      };
      const problem = validateSSOConnectionInput(asStored, {
        keepsSecret: secret === undefined,
      });
      if (problem) {
        throw new SSOConnectionRejected(problem);
      }
      await refuseUnsafeAddresses(context, next, loaded);

      // **Rule 3 of docs/design/sso-domain-verification.md.** Turning
      // enforcement on needs every domain verified. A connection that already
      // enforced keeps doing so (decision 2), so on one of those only a domain
      // added by this edit has to be.
      if (next.enforce) {
        const before = new Set(splitDomains(loaded.emailDomains));
        const now = splitDomains(next.emailDomains);
        await assertDomainsVerified(
          tx,
          workspaceId,
          loaded.enforce ? now.filter((domain) => !before.has(domain)) : now,
        );
      }

      const certificate =
        kind === "saml"
          ? normaliseCertificate(next.samlCertificate ?? "")
          : null;
      const sealed =
        secret === undefined
          ? null
          : encryptSecret(requireRing(context), secret);

      // openokr:allow-mutation: this is the operation's own execute, on the
      // transaction runOperation opened. The change, the activity and the
      // audit row commit together.
      const [updated] = await tx
        .update(ssoConnections)
        .set({
          ...next,
          samlCertificate: certificate,
          ...(sealed
            ? {
                secretCiphertext: sealed.ciphertext,
                secretDataKey: sealed.dataKey,
                secretKeyId: sealed.keyId,
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(
          activeOnly(
            ssoConnections,
            eq(ssoConnections.workspaceId, workspaceId),
            eq(ssoConnections.id, loaded.id),
          ),
        )
        .returning();
      if (!updated) {
        throw new OperationError(
          "not_found",
          "No such single sign-on connection in this workspace.",
        );
      }
      await keepPluginInStep(tx, updated, context.baseUrl);

      // Which fields moved, by name. Never a value: the secret is the obvious
      // one, and the rest are in the row for anybody allowed to read it.
      const changed: string[] = (
        Object.keys(next) as (keyof typeof next)[]
      ).filter((field) =>
        field === "samlCertificate"
          ? certificate !== loaded.samlCertificate
          : next[field] !== loaded[field],
      );
      if (sealed) {
        changed.push("clientSecret");
      }

      return {
        result: toDetails(updated),
        activity: {
          kind: "sso.connection_updated",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { name: updated.displayName },
        },
        audit: {
          action: "sso.updateConnection",
          targetType: "sso_connection",
          targetId: updated.id,
          payload: { providerId: updated.providerId, changed },
        },
      };
    },
  }),
});

export const setSSOConnectionEnabled = defineWriteAction({
  name: "sso.setConnectionEnabled",
  summary:
    "Turns a single sign-on connection off, so nobody signs in through it and it leaves the sign-in page, or on again.",
  input: z.object({ id: z.uuid(), enabled: z.boolean() }),
  output: connectionOutput,
  access: ACCESS_LEVELS.full,
  operation: (context, input) => ({
    load: ({ tx, workspaceId }) => loadConnection(tx, workspaceId, input.id),
    async execute({ tx, workspaceId, loaded }) {
      // openokr:allow-mutation: this is the operation's own execute.
      const [updated] = await tx
        .update(ssoConnections)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(
          activeOnly(
            ssoConnections,
            eq(ssoConnections.workspaceId, workspaceId),
            eq(ssoConnections.id, loaded.id),
          ),
        )
        .returning();
      if (!updated) {
        throw new OperationError(
          "not_found",
          "No such single sign-on connection in this workspace.",
        );
      }
      await keepPluginInStep(tx, updated, context.baseUrl);

      return {
        result: toDetails(updated),
        activity: {
          kind: "sso.connection_switched",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { name: updated.displayName, enabled: updated.enabled },
        },
        audit: {
          action: "sso.setConnectionEnabled",
          targetType: "sso_connection",
          targetId: updated.id,
          // Enforcement is read only from enabled rows, so turning off an
          // enforcing connection hands its domains back to passwords. The
          // audit row says which domains, so that is answerable later.
          payload: {
            providerId: updated.providerId,
            enabled: updated.enabled,
            enforce: updated.enforce,
            emailDomains: updated.emailDomains,
          },
        },
      };
    },
  }),
});

export const removeSSOConnection = defineWriteAction({
  name: "sso.removeConnection",
  summary:
    "Removes a single sign-on connection. Nobody signs in through it again, and an enforced connection's domains go back to passwords.",
  input: z.object({ id: z.uuid() }),
  output: z.object({ id: z.string() }),
  access: ACCESS_LEVELS.full,
  safety: "destructive",
  operation: (_context, input) => ({
    load: ({ tx, workspaceId }) => loadConnection(tx, workspaceId, input.id),
    async execute({ tx, workspaceId, loaded }) {
      // Soft delete, the repository's default. The row stays for the audit
      // trail's sake, and the partial unique index frees its provider ID so
      // the same callback address can be added again.
      // openokr:allow-mutation: this is the operation's own execute.
      const [removed] = await tx
        .update(ssoConnections)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          activeOnly(
            ssoConnections,
            eq(ssoConnections.workspaceId, workspaceId),
            eq(ssoConnections.id, loaded.id),
          ),
        )
        .returning();
      if (!removed) {
        throw new OperationError(
          "not_found",
          "No such single sign-on connection in this workspace.",
        );
      }
      await keepPluginInStep(tx, removed, undefined);

      return {
        result: { id: removed.id },
        activity: {
          kind: "sso.connection_removed",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { name: removed.displayName },
        },
        audit: {
          action: "sso.removeConnection",
          targetType: "sso_connection",
          targetId: removed.id,
          payload: {
            providerId: removed.providerId,
            enforce: removed.enforce,
            emailDomains: removed.emailDomains,
          },
        },
      };
    },
  }),
});
