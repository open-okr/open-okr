import type { ReactNode } from "react";
import { AppShellLayout } from "../../lib/app-shell.tsx";

/** The application shell around this segment, as `account/layout.tsx` explains. */
export default function SegmentLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <AppShellLayout>{children}</AppShellLayout>;
}
