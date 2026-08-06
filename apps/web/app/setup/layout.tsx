import { readSetupState, setupRefusal } from "@openokr/core";
import Link from "next/link";
import type { ReactNode } from "react";
import { getPool } from "../../lib/auth";

/**
 * The first-run wizard's shell, and its lock (P1-T09).
 *
 * Every setup route sits under this layout, so the "is this instance already
 * configured" question is asked once, in one place, for all of them. A guard
 * repeated per page is a guard that will eventually be forgotten on a page.
 *
 * The check runs on every request rather than being cached. It is one indexed
 * lookup, and the failure mode of a stale cache here is an open setup wizard
 * on a live instance.
 */
export const dynamic = "force-dynamic";

export default async function SetupLayout({
  children,
}: {
  children: ReactNode;
}) {
  const state = await readSetupState(getPool());
  const refusal = setupRefusal(state);

  return (
    <main style={{ maxWidth: "34rem", margin: "3rem auto", padding: "0 1rem" }}>
      {refusal ? (
        <>
          <h1>Setup is already done</h1>
          <p>{refusal}</p>
          <p>
            <Link href="/">Go to the instance</Link>
          </p>
        </>
      ) : (
        children
      )}
    </main>
  );
}
