import { glob } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Every route segment has an error boundary (P6-G24a).
 *
 * UIUX-PLAN.md §4 asks for "a surface-level error card with retry, never a
 * blank screen, an error boundary per route segment", and before this there
 * was one, at the root, so any failed read replaced the whole application. The
 * gap audit of 7 September 2026 recorded it as G-07.
 *
 * This is a test rather than a habit because the failure is invisible in a
 * diff: the missing file is the one nobody opened. A segment added next month
 * fails here rather than being found by somebody clicking into it.
 *
 * **The loading half of this test was removed the same day it was written, and
 * that is worth reading.** P6-G24a shipped a `loading.tsx` per segment as well,
 * and twenty-two of them turned the end-to-end suite from 184 passing into 75
 * passing and 86 not run. A `loading.tsx` makes Next stream the segment behind
 * a Suspense boundary, so `page.goto` resolves once the fallback is painted and
 * a spec that asserts immediately races the streamed content; one assertion
 * caught two copies of the same chip in the DOM at once. These specs are
 * serial, so one failure stops the rest.
 *
 * The boundaries are right and §9 asks for them. What is not yet understood is
 * the duplicate render, which may be a real defect the boundaries merely
 * exposed, and that has to be explained before they land again. **P6-G24c**
 * carries both halves. Asserting a loading state here now would be a test
 * demanding something the branch deliberately does not have.
 */

const APP = fileURLToPath(new URL("../app/", import.meta.url));

/**
 * Segments that own no boundary of their own and inherit the one above.
 *
 * Next resolves `loading.tsx` and `error.tsx` to the nearest ancestor that has
 * one, so a nested segment needs its own only when its shape differs. Each
 * entry here is a claim that inheriting is right, not a place to park a segment
 * somebody forgot.
 */
const INHERITS: Readonly<Record<string, string>> = {
  "dev/": "development only, and notFound() in production",
};

// `api/`, `.well-known/` and `fonts` needed no entry here and had one until the
// staleness test below rejected all three: they hold no `page.tsx`, so they are
// never segments this file sees. An exemption for something that never appears
// is a note nobody reads again, and it hides whatever is added under it later.

/** Directories under `app/` that hold a `page.tsx`, deepest first. */
async function segments(): Promise<readonly string[]> {
  const found = new Set<string>();
  for await (const entry of glob("**/page.tsx", { cwd: APP })) {
    const relative = entry.replaceAll("\\", "/");
    const cut = relative.lastIndexOf("/");
    found.add(cut === -1 ? "" : relative.slice(0, cut));
  }
  return [...found].sort();
}

async function has(file: string): Promise<ReadonlySet<string>> {
  const found = new Set<string>();
  for await (const entry of glob(`**/${file}`, { cwd: APP })) {
    const relative = entry.replaceAll("\\", "/");
    const cut = relative.lastIndexOf("/");
    found.add(cut === -1 ? "" : relative.slice(0, cut));
  }
  return found;
}

/**
 * The nearest ancestor with a boundary, or null.
 *
 * A route group like `(auth)` is a layout boundary but not a path segment, so
 * it is walked the same way: the resolution Next does is over directories, not
 * over URLs.
 */
function resolvedFrom(
  segment: string,
  owners: ReadonlySet<string>,
): string | null {
  const parts = segment === "" ? [] : segment.split("/");
  for (let depth = parts.length; depth >= 0; depth--) {
    const candidate = parts.slice(0, depth).join("/");
    if (owners.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

const exempt = (segment: string): boolean =>
  Object.keys(INHERITS).some(
    (prefix) => segment === prefix || segment.startsWith(prefix),
  );

describe("route segment boundaries", () => {
  test("finds every segment", async () => {
    // A glob resolved from the wrong directory finds nothing and makes every
    // assertion below pass. page-width.test.ts and reachability.test.ts carry
    // the same guard for the same reason.
    const found = await segments();
    expect(found.length).toBeGreaterThan(30);
    expect(found).toContain("goals");
    expect(found).toContain("(auth)/sign-in");
  });

  test("every segment resolves an error boundary", async () => {
    const owners = await has("error.tsx");
    const orphans = (await segments()).filter(
      (segment) => !exempt(segment) && resolvedFrom(segment, owners) === null,
    );
    expect(orphans).toEqual([]);
  });

  test("no segment has a loading state yet, and that is on purpose", async () => {
    // The inverse of the assertion this file was written with. Twenty-two
    // `loading.tsx` files took the end-to-end suite from 184 passing to 75, so
    // they came back out; putting one back before P6-G24c explains the
    // duplicate render would break the suite again, quietly, from a file
    // nobody reviewed twice.
    const owners = await has("loading.tsx");
    expect([...owners]).toEqual([]);
  });

  test("no in-shell segment falls all the way back to the root boundary", async () => {
    // The root `error.tsx` renders standalone, with no shell, because whatever
    // threw may have been the shell's own read. That is right for the root and
    // wrong for a page inside the product: a failed KPI read should not look
    // like a broken instance. So every top-level in-shell segment owns one.
    const owners = await has("error.tsx");
    const shallow = (await segments())
      .filter((segment) => !exempt(segment) && segment !== "")
      .filter((segment) => !segment.startsWith("("))
      .filter((segment) => !segment.startsWith("setup"));
    for (const segment of shallow) {
      expect(resolvedFrom(segment, owners), segment).not.toBe("");
    }
  });

  test("the last boundary exists, for a root layout that throws", async () => {
    // `error.tsx` at the root cannot catch the root layout itself, and the root
    // layout loads the environment, reads the nonce and mounts three providers.
    const found = new Set<string>();
    for await (const entry of glob("global-error.tsx", { cwd: APP })) {
      found.add(entry);
    }
    expect(found.size).toBe(1);
  });

  test("no exemption is stale", async () => {
    const found = await segments();
    for (const prefix of Object.keys(INHERITS)) {
      // An exemption for a prefix nothing matches any more is a note nobody
      // will read again, and it hides the next segment added under it.
      const matches = found.some(
        (segment) => segment === prefix || segment.startsWith(prefix),
      );
      expect(matches, `${prefix} is exempted and matches no segment`).toBe(
        true,
      );
    }
  });
});
