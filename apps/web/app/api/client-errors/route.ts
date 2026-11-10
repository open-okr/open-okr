import { listMembershipsForUser, resolveActiveWorkspace } from "@openokr/core";
import { cookies } from "next/headers";
import { getPool } from "../../../lib/auth";
import { resolveBrowserFrames } from "../../../lib/browser-frames";
import { getCache } from "../../../lib/cache";
import { receiveClientError } from "../../../lib/client-errors";
import { currentSession } from "../../../lib/session";
import { ACTIVE_WORKSPACE_COOKIE } from "../../../lib/workspace";

export const dynamic = "force-dynamic";

/**
 * A browser's unexpected error (docs/design/error-reporting.md D16, D17, plan
 * 0.7.0 E3). Same origin, signed in, rate-limited, and always 204; the rules
 * are in `lib/client-errors.ts`.
 *
 * The workspace is read the way the shell reads it, without provisioning
 * one: a person with no workspace yet is still reported, with none named.
 */
export async function POST(request: Request): Promise<Response> {
  return receiveClientError(request, {
    async session() {
      const session = await currentSession();
      if (!session) {
        return null;
      }
      const memberships = await listMembershipsForUser(
        getPool(),
        session.user.id,
      );
      const active = resolveActiveWorkspace(
        memberships,
        (await cookies()).get(ACTIVE_WORKSPACE_COOKIE)?.value,
      );
      return {
        userId: session.user.id,
        workspaceId: active?.workspaceId ?? null,
        memberId: active?.memberId ?? null,
      };
    },
    rateLimit: (key, limit, windowSeconds) =>
      getCache().rateLimit(key, limit, windowSeconds),
    resolveFrames: (frames) => resolveBrowserFrames(frames),
  });
}
