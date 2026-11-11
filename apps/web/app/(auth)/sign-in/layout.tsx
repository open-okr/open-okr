import { EMAIL_VERIFICATION_LINK_SECONDS } from "@openokr/core";
import type { ReactNode } from "react";
import { pageTitle } from "../../../lib/page-title.ts";
import { LinkHoursProvider } from "../resend-link";

// The page is a client component, which cannot name its own tab, so the
// segment's layout does it (lib/page-title.ts).
export const generateMetadata = pageTitle("pageTitle.signIn");

/**
 * Also hands the page how long a confirmation link works, for "send the link
 * again" beside "Confirm your email first" (plan 0.8.0 S3). The page cannot
 * read the constant itself: it is a client component, and `packages/core`
 * must not reach a client bundle.
 */
export default function TitleLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <LinkHoursProvider hours={EMAIL_VERIFICATION_LINK_SECONDS / 3600}>
      {children}
    </LinkHoursProvider>
  );
}
