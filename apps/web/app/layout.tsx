import { loadEnv } from "@openokr/config";
import {
  CATALOGUES,
  QueryProvider,
  ThemeProvider,
  ToastProvider,
  TranslationsProvider,
  themeInitScript,
  translate,
} from "@openokr/ui";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { getInstanceName } from "../lib/instance-name";
import { InstanceNameProvider } from "../lib/instance-name-context";
import { resolveLocale } from "../lib/locale";
import "./globals.css";

/**
 * The tab title is the instance's name (completeness review M-33).
 *
 * It was the literal "OpenOKR", so an operator who named their instance saw
 * the software's name on every tab. Resolved per request, like everything
 * else this layout reads, so a rename shows on the next page load.
 */
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: await getInstanceName(),
    description: "Your OKR coach, built in. Open source, AI-native.",
  };
}

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

  // **The locale was a literal here from P2-T10 until P6-G22a.** It has to be
  // decided on the server, because the server is where the text renders, and
  // it has to survive a request with no member: this layout wraps the
  // signed-out screens too. `resolveLocale` never throws and answers English
  // for a visitor the product does not know yet.
  const locale = await resolveLocale();
  // For the client components that name the instance, the sign-in heading
  // first among them (M-33). Never throws, so it cannot take the layout down.
  const instanceName = await getInstanceName();

  return (
    <html
      lang={locale}
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
          <TranslationsProvider locale={locale}>
            {/*
             * Here rather than in the shell (M-13). Each top-level screen
             * renders the shell afresh, so a provider inside it was replaced
             * on every move between screens and its toasts went with it. A
             * delete's undo is offered on the page that sends you somewhere
             * else, and has to still be there when you arrive.
             */}
            <ToastProvider
              dismissLabel={translate(CATALOGUES[locale], "common.dismiss")}
            >
              <QueryProvider buildId={loadEnv().APP_BUILD_ID}>
                <InstanceNameProvider name={instanceName}>
                  {children}
                </InstanceNameProvider>
              </QueryProvider>
            </ToastProvider>
          </TranslationsProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
