import Link from "next/link";
import { Suspense } from "react";
import { APP_NAME } from "../lib/app-info";
import { requireWorkspace } from "../lib/workspace";
import { OverviewSkeleton } from "./overview-skeleton";
import { SignOut } from "./sign-out";
import { WorkspaceOverview } from "./workspace-overview";

/**
 * The proving dashboard (P1-T08).
 *
 * One authenticated page that exercises the whole stack on a single request:
 * the session, the workspace the request is scoped to, the tenant floor, and a
 * read through the action contract registry.
 *
 * Scaffolding, deliberately. S-01, the Work Map, is the real home and replaces
 * this route at P3-T11, so nothing here is worth designing twice.
 *
 * The shell renders immediately and the workspace panel streams in behind a
 * Suspense boundary (§13.3: server-streamed first paint, with the interactive
 * parts hydrating on the client).
 */
export default async function HomePage() {
  const active = await requireWorkspace();

  return (
    <main style={{ maxWidth: "32rem", margin: "3rem auto", padding: "0 1rem" }}>
      <h1>{APP_NAME}</h1>

      <Suspense fallback={<OverviewSkeleton />}>
        <WorkspaceOverview active={active} />
      </Suspense>

      <p>
        <Link href="/account/security">Security settings</Link>
      </p>
      <SignOut />
    </main>
  );
}
