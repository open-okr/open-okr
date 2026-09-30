import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { readScreen, withMessages } from "./screen-text.ts";

/**
 * Joining a workspace because it trusts your email domain (completeness
 * review M-34).
 *
 * What joining does and refuses is proved against a real database in
 * `packages/core` (`trusted-domain.test.ts`): a confirmed address only, no
 * member somebody suspended or removed, the seat limit, and a cross-tenant
 * read that returns a name and an id. What is checked here is where a person
 * meets it: the front door sends somebody with no workspace to choose before
 * anything is made for them, the join page offers one press per workspace and
 * a workspace of their own, a member sees the same offer on the Work Map, and
 * the write behind the button asks the same question the page did.
 */

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const source = (path: string) => readFileSync(at(path), "utf8");

const page = source("../app/join/page.tsx");
const pageText = withMessages(readScreen(at("../app/join/page.tsx")));
const actions = source("../app/join/trusted-actions.ts");
const form = source("../app/join/trusted-offer-form.tsx");
const card = source("../app/trusted-domain-offers.tsx");
const home = source("../app/(home)/page.tsx");
const workspace = source("../lib/workspace.ts");
const general = source("../app/admin/general/general-settings-form.tsx");
const generalText = withMessages(
  readScreen(at("../app/admin/general/general-settings-form.tsx")),
);

describe("somebody with no workspace yet", () => {
  const empty = workspace.slice(
    workspace.indexOf("if (memberships.length === 0)"),
    workspace.indexOf("const requested"),
  );

  test("is sent to choose when their domain is trusted, before anything is made for them", () => {
    expect(empty).toContain("trustedDomainOffers(pool, session.user.id)");
    expect(empty).toContain("redirect(TRUSTED_DOMAIN_JOIN_PATH)");
    expect(workspace).toContain('TRUSTED_DOMAIN_JOIN_PATH = "/join"');
    // The offer is asked first: provisioning after it is the fallback, not a
    // race with it.
    expect(empty.indexOf("trustedDomainOffers(")).toBeLessThan(
      empty.indexOf("provisionWorkspaceForUser("),
    );
  });

  test("the join page never asks for a workspace, so it cannot send them in a loop", () => {
    // The call and the import, not the doc comment that explains why.
    expect(page).not.toContain("requireWorkspace(");
    expect(page).not.toMatch(/import \{[^}]*requireWorkspace/);
    expect(page).toContain("requireSession()");
  });
});

describe("the join page", () => {
  test("offers one press per workspace the address admits", () => {
    expect(page).toContain("trustedDomainOffers(pool, session.user.id)");
    expect(page).toContain("offers.map((offer)");
    expect(page).toContain("<TrustedOfferForm");
    expect(pageText).toContain("Workspaces you can join");
    expect(pageText).toContain(
      "Your confirmed address at {domain} lets you join these without an invitation.",
    );
  });

  test("offers a workspace of their own only to somebody who has none", () => {
    expect(page).toMatch(
      /memberships\.length === 0 \?\s*\(\s*<form\s+action=\{startOwnWorkspace\}/,
    );
    expect(pageText).toContain("Start my own workspace");
    // Somebody who already has one is told they can leave it for now.
    expect(pageText).toContain("Not now");
  });

  test("sends somebody with nothing on offer to the front door rather than an empty card", () => {
    expect(page).toMatch(
      /if \(offers\.length === 0\) \{\s*redirect\("\/"\);\s*\}/,
    );
  });
});

describe("the write behind the button", () => {
  const join = actions.slice(
    actions.indexOf("export async function joinTrustedWorkspace"),
    actions.indexOf("export async function startOwnWorkspace"),
  );

  test("checks the workspace is on this person's own offer before it runs", () => {
    expect(join.indexOf("trustedDomainOffers(")).toBeLessThan(
      join.indexOf("callAction("),
    );
    expect(join).toContain('"invitations.joinByTrustedDomain"');
  });

  test("sends nothing that could decide the level", () => {
    // The level is the funnel's default. A field for it would be a way for a
    // crafted request to ask for more.
    expect(join).not.toMatch(/level/i);
  });

  test("lands them in the workspace they joined", () => {
    expect(join).toContain("await landIn(workspaceId)");
    expect(actions).toContain("ACTIVE_WORKSPACE_COOKIE");
  });

  test("shows a refusal beside the button that caused it", () => {
    expect(form).toContain("useActionState(");
    expect(form).toContain('role="alert"');
    expect(form).toContain('name="workspaceId"');
  });
});

describe("a member who already has a workspace", () => {
  test("is offered the same workspaces on the Work Map, where every sign-in lands", () => {
    expect(home).toContain("<TrustedDomainOffers");
    expect(card).toContain("trustedDomainOffers(getPool(), userId)");
    expect(card).toContain("<TrustedOfferForm");
    // Nothing drawn when nothing is on offer.
    expect(card).toMatch(/if \(offers\.length === 0\) \{\s*return null;/);
  });

  test("never loses the Work Map to a failed offer read", () => {
    expect(card).toContain(".catch(() => [])");
  });
});

describe("the general card", () => {
  test("says what a trusted domain does and the mail it depends on", () => {
    expect(general).toContain('aria-describedby="trustedEmailDomainsHint"');
    expect(generalText).toContain(
      "is offered this workspace when they sign in, and can join without an invitation",
    );
    expect(generalText).toContain("Confirming an address needs mail");
  });
});
