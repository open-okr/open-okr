import { loadEnv } from "@openokr/config";
import {
  QueryProvider,
  ThemeProvider,
  TranslationsProvider,
  themeInitScript,
} from "@openokr/ui";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenOKR",
  description: "Your OKR coach, built in. Open source, AI-native.",
};

// §2: "Inter, self-hosted." `next/font/google` fetches once at build time
// and serves it from this origin — no runtime request to Google.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export default async function RootLayout({ children }: { children: ReactNode }) {
  // proxy.ts's own strict CSP has no `unsafe-inline` for scripts in
  // production — an inline <script> with no nonce is silently blocked by
  // the browser, which is exactly what happened to the theme bootstrap
  // below before this line existed. `x-nonce` is the same per-request
  // value proxy.ts already generates and forwards for this.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      className={inter.variable}
      data-theme="light"
      data-density="comfortable"
      suppressHydrationWarning
    >
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: the
         * no-flash theme bootstrap has to run before hydration, which
         * only a synchronous inline script can do (Next's own documented
         * pattern for this). The string is generated, not user input. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
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
