import { loadEnv } from "@openokr/config";
import {
  QueryProvider,
  ThemeProvider,
  TranslationsProvider,
  themeInitScript,
} from "@openokr/ui";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenOKR",
  description: "Your OKR coach, built in. Open source, AI-native.",
};

/**
 * §2: "Geist, self-hosted." The file is committed at `app/fonts/`, straight
 * from Vercel's own release, rather than fetched by `next/font/google`.
 *
 * Both self-host what the browser downloads. The difference is the *build*:
 * `next/font/google` reaches fonts.googleapis.com while it runs, so an
 * air-gapped build fails. See `app/fonts/README.md` for the version, the
 * source and the checksum.
 *
 * One variable file covers 100 to 900, so `weight` is the range rather than a
 * list, and there is one request instead of nine. `display: "swap"` keeps text
 * readable while it loads: a 68 KB font must never blank the page.
 */
const geistSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-sans-face",
  // The stack tokens.css falls back through, declared here too so the metrics
  // Next computes for its size-adjust fallback come from the same face the
  // browser would actually use.
  fallback: [
    "-apple-system",
    "SF Pro Text",
    "Helvetica Neue",
    "Arial",
    "sans-serif",
  ],
});

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  // proxy.ts's own strict CSP has no `unsafe-inline` for scripts in
  // production — an inline <script> with no nonce is silently blocked by
  // the browser, which is exactly what happened to the theme bootstrap
  // below before this line existed. `x-nonce` is the same per-request
  // value proxy.ts already generates and forwards for this.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      className={geistSans.variable}
      data-theme="light"
      data-density="comfortable"
      suppressHydrationWarning
    >
      <head>
        <script
          nonce={nonce}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: the no-flash theme bootstrap has to run before hydration, which only a synchronous inline script can do (Next's own documented pattern for this); the string is generated, not user input
          dangerouslySetInnerHTML={{ __html: themeInitScript() }}
        />
      </head>
      <body>
        <ThemeProvider>
          <TranslationsProvider locale="en">
            <QueryProvider buildId={loadEnv().APP_BUILD_ID}>
              {children}
            </QueryProvider>
          </TranslationsProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
