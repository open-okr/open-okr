/**
 * The directory-sync (SCIM) bearer token, minted by an administrator.
 *
 * **A write through the Operation pipeline, so it is audited.** Minting a token
 * revokes the one before it and hands out a credential that can create and
 * remove members, and until now it left no audit row. The row names the actor.
 *
 * **The token is in the answer once and nowhere else.** The pipeline stores its
 * SHA-256 digest. The activity and audit payloads carry the label and the id of
 * the token it replaced, never the token and never its digest.
 */
import { directorySyncTokens } from "@openokr/db";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { ACCESS_LEVELS } from "../access/levels.ts";
import { generateSCIMToken, hashSCIMToken } from "../directory-sync/tokens.ts";
import { OperationError } from "../operations/operation.ts";
import { defineWriteAction } from "./define.ts";

export const createDirectoryToken = defineWriteAction({
  name: "directory.createToken",
  agentSurface: false,
  summary:
    "Mints this workspace's directory-sync (SCIM) token, shown once, and revokes the one before it.",
  input: z.object({ label: z.string().trim().max(200).optional() }),
  output: z.object({
    id: z.uuid(),
    /** The only time this is ever returned. */
    token: z.string(),
  }),
  access: ACCESS_LEVELS.full,
  operation: (_context, input) => ({
    async execute({ tx, workspaceId }) {
      const plaintext = generateSCIMToken();
      const label = input.label?.trim() || "SCIM token";

      // openokr:allow-mutation: this is the operation's own execute. The
      // revocation and the insert are the one live token moving, so they
      // commit together with the audit row.
      const revoked = await tx
        .update(directorySyncTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(directorySyncTokens.workspaceId, workspaceId),
            isNull(directorySyncTokens.revokedAt),
          ),
        )
        .returning({ id: directorySyncTokens.id });

      // openokr:allow-mutation: the same operation, the same transaction.
      const [row] = await tx
        .insert(directorySyncTokens)
        .values({
          workspaceId,
          tokenHash: hashSCIMToken(plaintext),
          label,
        })
        .returning({ id: directorySyncTokens.id });
      if (!row) {
        throw new OperationError("not_found", "Could not mint that token.");
      }

      return {
        result: { id: row.id, token: plaintext },
        activity: {
          kind: "directory.token_created",
          subjectType: "workspace",
          subjectId: workspaceId,
          payload: { label },
        },
        audit: {
          action: "directory.createToken",
          targetType: "directory_sync_token",
          targetId: row.id,
          payload: { label, revokedTokenIds: revoked.map((one) => one.id) },
        },
      };
    },
  }),
});
