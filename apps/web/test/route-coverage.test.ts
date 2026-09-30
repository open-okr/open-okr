import { existsSync, readdirSync, readFileSync } from "node:fs";
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
  // Counted as visited until M-30, because `/people` was: the directory link
  // is followed, never typed.
  "/people/[id]":
    "reached by clicking a member in the directory and in the org chart in s33-people, which is how a member arrives there",
  "/documents/[id]":
    "reached by clicking its own goal's link in s29-documents, because there is no document index to navigate from",
  "/session/[id]/minutes":
    "reached from the session screen in sessions.spec.ts once a session has closed, which is the only state the minutes exist in",
  "/reset-password":
    "needs a token from a delivered email; the token path itself is proved in packages/core, and a spec here would have to read the outbox and forge the link",
  "/backup-code":
    "needs an enrolled second factor and one of its own codes, which is P7's row rather than a screen this suite can reach",
  "/dev/components":
    "development only, and notFound() in production, so there is nothing to open on the instance the suite builds",
  "/dev/rich-text":
    "development only, and notFound() in production, so there is nothing to open on the instance the suite builds",
  // `/admin/plan` and the three operator routes had reasons here until
  // completeness review L-17: each answers not-found with `cloud.enabled`
  // off. `s45-operator-console.spec.ts` turns the flag on for its own length
  // and opens all four.
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

/**
 * The accessibility scan is read as evidence of nothing, on purpose.
 *
 * It derives its own screen list by walking the route tree, and it writes
 * down the routes it deliberately does **not** open, each with a reason
 * (P7-T05). Every one of those is a url in the file, and this test reads a
 * url in a file as a visit, so leaving it in the corpus made six routes look
 * covered the day that spec landed and turned this test red for the exact
 * opposite reason: the excuses here were reported as stale.
 *
 * Naming a route is not opening it, and that spec is the one file in the
 * suite that names routes it will not open.
 */
const NAMES_ROUTES_WITHOUT_VISITING = "s43-accessibility.spec.ts";

const specs = readdirSync(E2E)
  .filter(
    (name) =>
      name.endsWith(".spec.ts") && name !== NAMES_ROUTES_WITHOUT_VISITING,
  )
  .map((name) => readFileSync(join(E2E, name), "utf8"))
  .join("\n");

/**
 * A route segment that stands for a value: an interpolation, or a literal id
 * or token. Never nothing, which is the whole point (completeness review
 * M-30): stripping the parameter used to turn `/initiatives/[id]` into
 * `/initiatives/`, a prefix every visit to `/initiatives` already carried, so
 * the detail page counted as opened whenever its list was.
 */
const VALUE = String.raw`(?:\$\{[^}]+\}|[A-Za-z0-9_-]+)`;
const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether any spec names this url, segment by segment. */
const visited = (route: string): boolean => {
  if (route === "/") {
    return /goTo\(page, "\/"\)|page\.goto\("\/"\)/.test(specs);
  }
  const segments = route
    .split("/")
    .map((segment) =>
      segment.startsWith("[") ? VALUE : escapeRegExp(segment),
    );
  // Opened by a quote or a backtick, and ended by one, a query or a fragment,
  // so `/goals` is not visited by a spec that only names `/goals/studio`.
  const whole = new RegExp(`["'\`]${segments.join("/")}(?=["'\`?#])`);
  if (whole.test(specs)) {
    return true;
  }
  // A url built by concatenation, `"/goals/" + id`, names its value outside
  // the literal. Only a route that ends on its value can be written that way.
  if (route.endsWith("]")) {
    const prefix = segments.slice(0, -1).join("/");
    return new RegExp(`["'\`]${prefix}/["'\`]\\s*\\+`).test(specs);
  }
  return false;
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

  test("a spec a reason names exists and goes near the route", () => {
    // Completeness review M-30: a reason that says a spec reaches a screen by
    // clicking is checked the only way a source test can, that the spec is
    // there and names the route's own path.
    const false_ = Object.entries(NO_DIRECT_VISIT).flatMap(([route, why]) => {
      const named = [
        ...why.matchAll(
          /\b(s\d+[a-z]?-[a-z0-9-]+|[a-z][a-z0-9-]*\.spec\.ts)\b/g,
        ),
      ].map((match) => match[1] ?? "");
      const stem = route.split("/[")[0] ?? route;
      return named.flatMap((spec) => {
        const file = join(
          E2E,
          spec.endsWith(".spec.ts") ? spec : `${spec}.spec.ts`,
        );
        if (!existsSync(file)) {
          return [`${route}: ${spec} does not exist`];
        }
        return readFileSync(file, "utf8").includes(stem)
          ? []
          : [`${route}: ${spec} never mentions ${stem}`];
      });
    });
    expect(false_).toEqual([]);
  });

  test("the reasons say something", () => {
    const thin = Object.entries(NO_DIRECT_VISIT)
      .filter(([, why]) => why.trim().length < 30)
      .map(([route]) => route);
    expect(thin).toEqual([]);
  });
});
