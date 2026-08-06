import { readSetupState } from "@openokr/core";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getPool } from "../../lib/auth";

/**
 * Sends an unconfigured instance to the wizard (P1-T09).
 *
 * A fresh deployment answers on port 443 with a sign-in page and no way to
 * sign in, which is a confusing first impression and the reason the 30-minute
 * budget usually goes. Landing on the wizard instead makes the next step
 * obvious.
 *
 * It lives here rather than in `proxy.ts` because the question is a database
 * read, and proxy code runs before rendering and must not touch the database.
 *
 * The redirect stops as soon as the wizard records completion, so an operator
 * who deliberately configured everything through environment variables and
 * finished setup never sees it again.
 */
export const dynamic = "force-dynamic";

export default async function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  const state = await readSetupState(getPool());

  if (!state.configured) {
    redirect("/setup");
  }

  return <>{children}</>;
}
