import type { ReactNode } from "react";
import { AppShellLayout } from "../../lib/app-shell.tsx";

/**
 * The Work Map's own shell (UIUX-PLAN §4 S-01, P6-G24b).
 *
 * **A route group, because `/` cannot have an intermediate layout otherwise.**
 * `app/layout.tsx` is the root layout: it renders the document and wraps the
 * signed-out screens as well, so the shell cannot go there. Every other screen
 * got a segment layout at this row, and the front door would have been the one
 * left with its error boundary outside the shell. A group changes no url:
 * `(home)/page.tsx` still serves `/`.
 */
export default function HomeLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <AppShellLayout>{children}</AppShellLayout>;
}
