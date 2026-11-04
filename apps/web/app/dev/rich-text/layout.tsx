import type { ReactNode } from "react";
import { pageTitle } from "../../../lib/page-title.ts";

// The page is a client component, which cannot name its own tab, so the
// segment's layout does it (lib/page-title.ts).
export const generateMetadata = pageTitle("pageTitle.devRichText");

export default function TitleLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return children;
}
