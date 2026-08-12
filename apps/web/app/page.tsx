import { Suspense } from "react";
import { AppShellLayout } from "../lib/app-shell.tsx";
import { requireWorkspace } from "../lib/workspace";
import { OverviewSkeleton } from "./overview-skeleton";
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
    <AppShellLayout>
      <div className="stagger mx-auto flex max-w-2xl flex-col gap-4.5">
        <Suspense fallback={<OverviewSkeleton />}>
          <WorkspaceOverview active={active} />
        </Suspense>
      </div>
    </AppShellLayout>
  );
}
