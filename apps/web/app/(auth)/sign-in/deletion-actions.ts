"use server";

import { deletionJustCancelled } from "@openokr/core";
import { headers } from "next/headers";
import { getAuth, getPool } from "../../../lib/auth";

/**
 * Where a sign-in lands (docs/design/account-deletion.md §3.2, plan 0.8.0
 * Y7): Your account, saying the account is kept, when this sign-in just
 * cancelled a deletion the person had asked for; home otherwise.
 *
 * The cancellation itself happened inside the sign-in, in the session hook,
 * so this only reads what became of the request.
 */
export async function pathAfterSignIn(): Promise<string> {
  const session = await getAuth()
    .api.getSession({ headers: await headers() })
    .catch(() => null);
  if (!session) {
    return "/";
  }
  const kept = await deletionJustCancelled(getPool(), session.user.id).catch(
    () => false,
  );
  return kept ? "/account?deletion=kept" : "/";
}
