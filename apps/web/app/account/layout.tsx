import type { ReactNode } from "react";
import { AppShellLayout } from "../../lib/app-shell.tsx";

/**
 * The application shell around this segment (UIUX-PLAN §4, P6-G24b).
 *
 * **Moved out of the pages so an error boundary can render inside it.** Every
 * page under here used to render `AppShellLayout` itself, which put the
 * segment's `error.tsx` *outside* the shell: a failed read replaced the
 * sidebar, the topbar and the navigation along with the panel that failed, and
 * a reader had no way back except the browser's own history. Next renders a
 * segment's error boundary inside that segment's layout, so the shell has to
 * be the layout for the boundary to sit within it. `admin/layout.tsx` has
 * done it this way since P2-T08 and is the shape this follows.
 */
export default function SegmentLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <AppShellLayout>{children}</AppShellLayout>;
}
