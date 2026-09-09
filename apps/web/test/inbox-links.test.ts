import { NOTIFICATION_REASONS, NUDGE_SUBJECT_TYPES } from "@openokr/db";
import { describe, expect, test } from "vitest";
import {
  LINKED_SUBJECT_TYPES,
  REASON_LABELS,
  subjectLink,
  subjectName,
} from "../app/inbox/subject-link.ts";

/**
 * The inbox's deep links (S-03, P6-G07a).
 *
 * The acceptance criterion for that screen is that a row "deep-links to the
 * comment", and a link computed inline in a server component is a link nothing
 * can assert. So the table lives in its own pure module and this is what holds
 * it honest.
 *
 * **Two failures this catches that reading the page cannot.** A subject type
 * pointed at a route that does not exist, which was the first draft's
 * `/board?task=` and `/blockers/<id>`: neither route is in `apps/web/app`. And
 * a reason with no chip label, which is how `notifications.list` came to
 * describe four of the table's six reasons for three phases.
 */

describe("subjectLink", () => {
  test("every linked subject type points at a route that exists", async () => {
    // Derived from the app directory rather than a list, so a route renamed
    // next month fails here instead of in a reader's browser.
    const { glob } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const app = fileURLToPath(new URL("../app/", import.meta.url));
    const routes = new Set<string>();
    for await (const entry of glob("**/page.tsx", { cwd: app })) {
      // **A route group is not a path segment**, which this copy of the
      // derivation missed until P6-G24b moved `/` into `(home)`. It was latent
      // rather than harmless: `(auth)` has existed since P1-T09 and every one
      // of its routes has been in this set under the wrong name ever since.
      // `reachability.test.ts` has always stripped them.
      const segments = entry
        .replaceAll("\\", "/")
        .replace(/\/?page\.tsx$/, "")
        .split("/")
        .filter((segment) => segment !== "" && !segment.startsWith("("));
      routes.add(`/${segments.join("/")}`);
    }

    const broken: string[] = [];
    for (const subjectType of LINKED_SUBJECT_TYPES) {
      const href = subjectLink(
        subjectType,
        "00000000-0000-4000-8000-000000000000",
      );
      if (href === null) {
        broken.push(`${subjectType}: listed but returns null`);
        continue;
      }
      // The id segment back to its literal form, which is how the route
      // directory spells it.
      const pattern = href
        .replace("00000000-0000-4000-8000-000000000000", "[id]")
        .replace(/\?.*$/, "");
      const normalised = pattern === "/" ? "/" : pattern;
      if (!routes.has(normalised)) {
        broken.push(`${subjectType}: ${href} has no page`);
      }
    }
    expect(broken).toEqual([]);
  });

  test("an unknown or absent subject gets no link rather than a bad one", () => {
    expect(subjectLink(null, null)).toBeNull();
    expect(subjectLink("goal", null)).toBeNull();
    expect(subjectLink("blocker", "00000000-0000-4000-8000-000000000000")).toBe(
      null,
    );
    expect(subjectLink("nonsense", "x")).toBeNull();
  });

  test("every nudge subject type has a name, linked or not", () => {
    // A nudge row is grouped under its subject's name whether or not it can be
    // linked, so a missing name renders the raw column value as a heading.
    const unnamed = NUDGE_SUBJECT_TYPES.filter(
      (subjectType) => subjectName(subjectType) === subjectType,
    );
    expect(unnamed).toEqual([]);
  });
});

describe("reason chips", () => {
  test("every reason the table allows has a label", () => {
    // `notifications.list` described four of these six until P6-G07a, and the
    // screen would have rendered "check_in" as a chip. Enumerated from the
    // table's own constant, so a seventh reason fails here.
    const missing = NOTIFICATION_REASONS.filter(
      (reason) => REASON_LABELS[reason] === undefined,
    );
    expect(missing).toEqual([]);
  });

  test("no two reasons share a label", () => {
    const labels = NOTIFICATION_REASONS.map((reason) => REASON_LABELS[reason]);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
