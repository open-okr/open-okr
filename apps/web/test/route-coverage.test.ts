import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Every route is opened by a spec or says why not (GAP-AUDIT G-10, P6-G29).
 *
 * **Sixteen of forty-seven routes had no end-to-end path at all** when the
 * audit was written, and nobody had decided about any of them. P6-G29 opened
 * the ones a signed-in member can reach and wrote down the rest, which is the
 * half that lasts: the next audit reads a decision instead of counting the
 * same gap again.
 *
 * **A route counts as visited when a spec names its url.** That misses one
 * reached only by clicking a link, which is why several reasons below say
 * exactly that and name the spec doing the clicking. The alternative, running
 * the suite and recording what it touched, would make this test depend on a
 * browser and a database to answer a question about source.
 *
 * **The list only shrinks.** A new route with no spec and no reason fails
 * here, at the moment somebody can still write one.
 */

const APP = fileURLToPath(new URL("../app", import.meta.url));
const E2E = fileURLToPath(new URL("../../../e2e", import.meta.url));

const NO_DIRECT_VISIT: Readonly<Record<string, string>> = {
  "/documents/[id]":
    "reached by clicking its own goal's link in s29-documents, because there is no document index to navigate from",
  "/session/[id]/minutes":
    "reached from the session screen in sessions.spec.ts once a session has closed, which is the only state the minutes exist in",
  "/forgot-password":
    "the request half is covered in s35-join and the rest needs a delivered email, which the suite has no mailbox for",
  "/reset-password":
    "needs a token from a delivered email; the token path itself is proved in packages/core, and a spec here would have to read the outbox and forge the link",
  "/backup-code":
    "needs an enrolled second factor and one of its own codes, which is P7's row rather than a screen this suite can reach",
  "/dev/components":
    "development only, and notFound() in production, so there is nothing to open on the instance the suite builds",
  "/dev/rich-text":
    "development only, and notFound() in production, so there is nothing to open on the instance the suite builds",
};

function everyRoute(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".next") {
        continue;
      }
      found.push(...everyRoute(path));
    } else if (entry.name === "page.tsx") {
      const relative = path
        .slice(APP.length + 1)
        .split(sep)
        .join("/");
      const segments = relative
        .replace(/\/?page\.tsx$/, "")
        .split("/")
        .filter((segment) => segment !== "" && !segment.startsWith("("));
      found.push(`/${segments.join("/")}`);
    }
  }
  return found;
}

const specs = readdirSync(E2E)
  .filter((name) => name.endsWith(".spec.ts"))
  .map((name) => readFileSync(join(E2E, name), "utf8"))
  .join("\n");

/** Whether any spec names this url, with its parameters stripped. */
const visited = (route: string): boolean => {
  if (route === "/") {
    return /goTo\(page, "\/"\)|page\.goto\("\/"\)/.test(specs);
  }
  const stem = route.replace(/\[[^\]]+\]/g, "").replace(/\/+$/, "");
  return specs.includes(`"${stem}`) || specs.includes(`\`${stem}`);
};

const routes = everyRoute(APP).sort();
const unvisited = routes.filter((route) => !visited(route));

describe("route coverage", () => {
  test("finds every route, so an empty glob cannot pass this file", () => {
    expect(routes.length).toBeGreaterThan(40);
    expect(routes).toContain("/goals");
    expect(routes).toContain("/");
  });

  test("every route is opened by a spec or has a written reason", () => {
    const undecided = unvisited.filter(
      (route) => NO_DIRECT_VISIT[route] === undefined,
    );
    expect(undecided).toEqual([]);
  });

  test("no reason outlives the route it excused", () => {
    const named: readonly string[] = Object.keys(NO_DIRECT_VISIT);
    const still: readonly string[] = unvisited;
    const stale = named.filter((route) => !still.includes(route));
    // Either a spec started opening it, in which case the line goes, or the
    // route was renamed, in which case the line points at nothing.
    expect(stale).toEqual([]);
  });

  test("the reasons say something", () => {
    const thin = Object.entries(NO_DIRECT_VISIT)
      .filter(([, why]) => why.trim().length < 30)
      .map(([route]) => route);
    expect(thin).toEqual([]);
  });
});
