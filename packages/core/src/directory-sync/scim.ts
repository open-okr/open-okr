/**
 * SCIM 2.0 request handling (P8-T08, RFC 7644).
 *
 * The identity provider pushes user and group changes here. Each operation
 * maps to an existing action:
 *
 * | SCIM operation | OpenOKR action |
 * |---|---|
 * | Create User | provisionMemberForInvite (the one member funnel) |
 * | Deactivate User | people.suspend |
 * | Reactivate User | people.restore |
 * | Create/Update Group | Map to space membership |
 *
 * **Deactivation maps to suspension and never to deletion.** That is the
 * acceptance criterion, and suspension already removes every access: both
 * `resolveMemberAccessLevel` and `resolveActor` exclude non-active members.
 */
import type { Pool } from "pg";

export interface SCIMUser {
  readonly schemas?: string[];
  readonly externalId?: string;
  readonly userName?: string;
  readonly name?: {
    readonly givenName?: string;
    readonly familyName?: string;
    readonly formatted?: string;
  };
  readonly emails?: ReadonlyArray<{
    readonly value?: string;
    readonly primary?: boolean;
    readonly type?: string;
  }>;
  readonly displayName?: string;
  readonly active?: boolean;
}

export interface SCIMGroup {
  readonly schemas?: string[];
  readonly externalId?: string;
  readonly displayName?: string;
  readonly members?: ReadonlyArray<{
    readonly value?: string;
    readonly display?: string;
  }>;
}

export interface SCIMListResponse<T> {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export interface SCIMError {
  schemas: string[];
  status: string;
  detail: string;
}

/** Extracts the primary email from a SCIM user resource. */
export function primaryEmail(user: SCIMUser): string | undefined {
  if (!user.emails || user.emails.length === 0) return user.userName;
  const primary = user.emails.find((e) => e.primary);
  return primary?.value ?? user.emails[0]?.value ?? user.userName;
}

/** Builds a display name from a SCIM user resource. */
export function displayName(user: SCIMUser): string {
  if (user.displayName) return user.displayName;
  if (user.name?.formatted) return user.name.formatted;
  const parts = [user.name?.givenName, user.name?.familyName].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return user.userName ?? "Unknown";
}

/**
 * Writes a sync log entry. Non-throwing: a log failure must not fail the
 * SCIM request.
 */
export async function logSyncOperation(
  pool: Pool,
  workspaceId: string,
  entry: {
    resourceType: string;
    operation: string;
    externalId: string;
    localId?: string;
    success: boolean;
    errorMessage?: string;
    requestBody?: unknown;
  },
): Promise<void> {
  try {
    // openokr:allow-mutation: the sync log is an operational record of
    // what the identity provider asked for. It is not a domain write and
    // has no audit row, activity row or outbox row of its own.
    await pool.query(
      `INSERT INTO directory_sync_log
        (workspace_id, resource_type, operation, external_id, local_id,
         success, error_message, request_body)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        workspaceId,
        entry.resourceType,
        entry.operation,
        entry.externalId,
        entry.localId ?? null,
        entry.success,
        entry.errorMessage ?? null,
        entry.requestBody ? JSON.stringify(entry.requestBody) : null,
      ],
    );
  } catch {
    // The log must not fail the operation. If the log table is missing
    // (unmigrated database), swallow silently.
  }
}

/** SCIM error response body. */
export function scimError(status: number, detail: string): SCIMError {
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: String(status),
    detail,
  };
}

/** SCIM list response wrapper. */
export function scimList<T>(resources: T[]): SCIMListResponse<T> {
  return {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: resources.length,
    startIndex: 1,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}
