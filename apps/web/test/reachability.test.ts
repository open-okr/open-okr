import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ACCESS_LEVELS, navigationFor } from "@openokr/core";
import { describe, expect, test } from "vitest";

/**
 * Every screen can be found without typing a URL.
 *
 * This repository has shipped the same defect three times. S-22 to S-25 were
 * built across P4-T07 to P4-T10 and nothing linked to any of them, so every
 * session feature was reachable only by typing `/session/<id>`; P5-T01c added
 * the Sessions entry. `/account/channels` shipped at P5-T02c with no link and
 * P5-T08 found it while about to ship a second one the same way. The gap audit
 * of 7 September 2026 then found `/account/connections`, which is the place
 * P5-T08c's own goal calls "where a person sees and ends what they granted".
 *
 * A page nobody can reach is not a feature. Reviewing a diff cannot catch this,
 * because the page and the link live in different files and the missing one is
 * the file that was never opened. So this is a test rather than a habit.
 *
 * **A route is reachable when the registry knows it, or when some source file
 * under `app/` or `lib/` names it.** Naming it is enough on purpose: a link
 * inside a card, a tab strip, a redirect or a menu all count, and asserting
 * that a rendered tree contains an anchor would mean rendering forty-seven
 * server components against a database this suite does not have.
 */

const APP = fileURLToPath(new URL("../app/", import.meta.url));
const LIB = fileURLToPath(new URL("../lib/", import.meta.url));

/**
 * Routes reached from outside the interface, each with the thing that sends
 * somebody there. An entry here is a claim that no in-app link should exist,
 * not a place to park a page somebody forgot to link.
 */
const REACHED_FROM_OUTSIDE: Readonly<Record<string, string>> = {
  "/reset-password": "the link in the password-reset email",
  "/backup-code": "the sign-in flow, when a second factor is required",
  "/account/device":
    "the URL `okr login` prints, and the code a person types there",
  "/oauth/authorize": "an external agent's authorisation redirect",
  "/setup": "the first run, before any member or navigation exists",
  "/setup/account": "the first-run wizard's own next step",
  "/dev/components": "development only; the page is notFound() in production",
  "/dev/rich-text": "development only; the page is notFound() in production",
};

/** `app/(auth)/sign-in/page.tsx` is `/sign-in`. Route groups are not path segments. */
function routeFor(pageFile: string): string {
  const segments = pageFile
    .replace(/(^|\/)page\.tsx$/, "")
    .split("/")
    .filter((segment) => segment !== "" && !segment.startsWith("("));
  return `/${segments.join("/")}`;
}

/** The directory a page lives in, so its own siblings can be excluded. */
function directoryOf(pageFile: string): string {
  const cut = pageFile.lastIndexOf("/");
  return cut === -1 ? "" : pageFile.slice(0, cut + 1);
}

interface Page {
  readonly route: string;
  /** Relative to `app/`, with a trailing slash. Its own siblings prove nothing. */
  readonly directory: string;
}

async function pages(): Promise<readonly Page[]> {
  const found: Page[] = [];
  for await (const entry of glob("**/page.tsx", { cwd: APP })) {
    const relative = entry.replaceAll("\\", "/");
    // The public REST surface, the webhooks and the agent endpoint are not
    // screens. None of them has a page.tsx today; this keeps it that way.
    if (relative.startsWith("api/")) {
      continue;
    }
    found.push({ route: routeFor(relative), directory: directoryOf(relative) });
  }
  return found.sort((a, b) => a.route.localeCompare(b.route));
}

interface SourceFile {
  /** Relative to `app/` for app files, and prefixed `lib/` for the rest. */
  readonly path: string;
  readonly text: string;
}

async function sourceFiles(): Promise<readonly SourceFile[]> {
  const files: SourceFile[] = [];
  for await (const entry of glob("**/*.{ts,tsx}", { cwd: APP })) {
    const relative = entry.replaceAll("\\", "/");
    files.push({
      path: relative,
      text: readFileSync(`${APP}${entry}`, "utf8"),
    });
  }
  for await (const entry of glob("**/*.{ts,tsx}", { cwd: LIB })) {
    const relative = entry.replaceAll("\\", "/");
    files.push({
      path: `lib/${relative}`,
      text: readFileSync(`${LIB}${entry}`, "utf8"),
    });
  }
  return files;
}

/**
 * Everything outside the page's own directory.
 *
 * A page naming its own route proves nothing, and neither does the
 * `revalidatePath` in the action file beside it. That second case is exactly
 * what hid `/account/connections`: the only mention of it anywhere in the
 * application was the revalidation call in its own directory.
 */
function textOutside(files: readonly SourceFile[], directory: string): string {
  return files
    .filter((file) => directory === "" || !file.path.startsWith(directory))
    .map((file) => file.text)
    .join("\n");
}

/**
 * A dynamic route is named when something builds a path with its prefix, so
 * `/goals/[id]` is satisfied by `` `/goals/${goal.id}` `` and by `/goals/` in
 * a string. The prefix is everything before the first dynamic segment.
 */
function isNamed(
  route: string,
  source: string,
  registry: readonly string[],
): boolean {
  if (registry.includes(route)) {
    return true;
  }
  const dynamic = route.indexOf("/[");
  if (dynamic === -1) {
    return (
      source.includes(`"${route}"`) ||
      source.includes(`${route}"`) ||
      source.includes(`${route}?`)
    );
  }
  return source.includes(`${route.slice(0, dynamic)}/`);
}

describe("route reachability", () => {
  test("finds every page", async () => {
    const routes = (await pages()).map((page) => page.route);
    // A glob resolved from the wrong directory finds nothing and makes every
    // assertion below pass. page-width.test.ts carries the same guard for the
    // same reason.
    expect(routes.length).toBeGreaterThan(40);
    expect(routes).toContain("/");
    expect(routes).toContain("/review");
  });

  test("every page is in the registry, named in source, or reached from outside", async () => {
    const found = await pages();
    const files = await sourceFiles();
    const registry = navigationFor("sidebar", ACCESS_LEVELS.full)
      .concat(navigationFor("admin", ACCESS_LEVELS.full))
      .map((item) => item.href);

    const orphans = found
      .filter(
        (page) =>
          !(page.route in REACHED_FROM_OUTSIDE) &&
          !isNamed(page.route, textOutside(files, page.directory), registry),
      )
      .map((page) => page.route);
    expect(orphans).toEqual([]);
  });

  test("no exemption is stale", async () => {
    const routes = (await pages()).map((page) => page.route);
    for (const route of Object.keys(REACHED_FROM_OUTSIDE)) {
      // An exemption for a route that no longer exists is a note nobody will
      // ever read again, and it hides the next page added at that address.
      expect(routes, `${route} is exempted and does not exist`).toContain(
        route,
      );
    }
  });
});

describe("the avatar menu", () => {
  test("carries every account page the registry declares", () => {
    const account = navigationFor("sidebar", ACCESS_LEVELS.full).filter(
      (item) => item.group === "account",
    );
    // The menu is built from this list rather than from a literal array, so
    // the assertion is that the list is the whole of `/account/*`. Adding a
    // page without a registry row fails the orphan test above; adding a row
    // without a page fails page-width.test.ts.
    expect(account.map((item) => item.href).sort()).toEqual([
      "/account/api-tokens",
      "/account/channels",
      "/account/connections",
      "/account/security",
    ]);
  });
});
