"use client";

/**
 * The page's half of browser error reporting (docs/design/error-reporting.md
 * D16, plan 0.7.0 E3).
 *
 * Mounted once in the root layout, it listens for `error` and
 * `unhandledrejection` and posts each to `/api/client-errors` on the same
 * origin. Every error boundary calls `reportClientError` once as well. The
 * server decides what is kept: a page cannot be trusted to scrub itself, so
 * this only sends and never judges.
 *
 * **No DSN and no tracker host reach the browser.** The address below is our
 * own server, so this works on an isolated network and needs no change to
 * the content-security policy.
 */
import { useParams, usePathname } from "next/navigation";
import { useEffect } from "react";

const ENDPOINT = "/api/client-errors";
/** One page load reports at most this many; the server caps per minute too. */
const PAGE_LIMIT = 10;
/** Comfortably under the server's 16 KB, so a long stack is cut, not refused. */
const STACK_LIMIT = 12_000;

type Kind = "error" | "rejection" | "boundary";

const state: { sent: number; route: string | null; seen: WeakSet<object> } = {
  sent: 0,
  route: null,
  seen: new WeakSet(),
};

/**
 * The route pattern of the page, `/goals/[id]`, never the address (D4).
 * Each parameter's value in the path is put back as its name.
 */
export function routePatternOf(
  pathname: string | null,
  params: Readonly<Record<string, string | string[] | undefined>> | null,
): string | null {
  if (!pathname) {
    return null;
  }
  let pattern = pathname;
  for (const [name, value] of Object.entries(params ?? {})) {
    if (value === undefined) {
      continue;
    }
    const joined = Array.isArray(value) ? value.join("/") : value;
    if (joined === "") {
      continue;
    }
    const placeholder = Array.isArray(value) ? `[...${name}]` : `[${name}]`;
    pattern = pattern
      .split("/")
      .map((segment) =>
        segment === joined || segment === encodeURIComponent(joined)
          ? placeholder
          : segment,
      )
      .join("/");
    if (Array.isArray(value)) {
      pattern = pattern.replace(
        `/${value.map(encodeURIComponent).join("/")}`,
        `/${placeholder}`,
      );
    }
  }
  return pattern;
}

/** The pattern of the page this is on, for a boundary's "Copy details". */
export function useRoutePattern(): string | null {
  const pathname = usePathname();
  const params = useParams();
  return routePatternOf(pathname, params);
}

/**
 * Sends one error to our own server, once. Never throws, never waits.
 *
 * An error with a digest is skipped: it happened on the server, which has
 * already reported it with that digest.
 */
export function reportClientError(error: unknown, kind: Kind): void {
  try {
    if (
      state.sent >= PAGE_LIMIT ||
      typeof error !== "object" ||
      error === null
    ) {
      return;
    }
    if (state.seen.has(error)) {
      return;
    }
    state.seen.add(error);
    const thrown = error as {
      name?: unknown;
      message?: unknown;
      stack?: unknown;
      digest?: unknown;
    };
    if (typeof thrown.digest === "string" && thrown.digest !== "") {
      return;
    }
    state.sent += 1;
    const body = JSON.stringify({
      kind,
      name:
        typeof thrown.name === "string" ? thrown.name.slice(0, 100) : "Error",
      message:
        typeof thrown.message === "string"
          ? thrown.message.slice(0, 2_000)
          : "",
      stack:
        typeof thrown.stack === "string"
          ? thrown.stack.slice(0, STACK_LIMIT)
          : "",
      ...(state.route ? { route: state.route.slice(0, 200) } : {}),
    });
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      credentials: "same-origin",
      // Sent even when the error is the page unloading.
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Reporting an error must never be a second one.
  }
}

/** The listeners, mounted once in the root layout. Renders nothing. */
export function ClientErrorReporter(): null {
  const route = useRoutePattern();

  useEffect(() => {
    state.route = route;
  }, [route]);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      // A cross-origin script's error arrives with no error object and says
      // only "Script error.", which tells nobody anything.
      if (event.error) {
        reportClientError(event.error, "error");
      }
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      reportClientError(event.reason, "rejection");
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
