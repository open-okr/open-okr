/**
 * Directory sync over SCIM 2.0 (P8-T08, rebuilt at P8-T08a).
 *
 * Acceptance criterion:
 *   Given a user removed from the directory, when the next synchronisation
 *   runs, then the member is suspended and every token and grant of theirs
 *   stops working.
 *
 * This spec exists because both halves of that sentence are only true over
 * HTTP. The bearer token has to resolve a workspace from a request that
 * carries nothing else, which is the exact arrangement that answered 401 to
 * every request until the tenant floor was opened for it (P8-T07a), and a
 * browser is the only place the token is ever shown.
 *
 * What SCIM does to a member, and that deactivation is suspension rather than
 * deletion, is proved against a real database in
 * `packages/core/test/directory-sync-users.test.ts`.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
/** The raw token, held for this file only. */
let token = "";
/** The member id SCIM gave the person it provisioned. */
let memberId = "";
/** The group id the Groups resource gave the space it mapped. */
let groupId = "";

const SCIM = "/api/scim/v2/Users";
const ADDRESS = "grace@directory.test";

const authed = () => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/scim+json",
});

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  // No cookies, so nothing here can pass because a browser happened to be
  // signed in. A directory has a token and nothing else.
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  await api?.dispose();
  await context?.close();
});

test("a workspace generates a SCIM token, shown once", async () => {
  await signIn(page);
  await goTo(page, "/admin/directory");

  await page.getByRole("button", { name: "Generate SCIM token" }).click();

  const shown = page.getByTestId("scim-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();
  expect(token.length).toBeGreaterThan(32);

  await goTo(page, "/admin/directory");
  const body = (await page.locator("body").textContent()) ?? "";
  expect(body).not.toContain(token);
});

test("a request with no token, or the wrong one, is refused", async () => {
  expect((await api.get(SCIM)).status()).toBe(401);
  expect(
    (
      await api.get(SCIM, { headers: { authorization: "Bearer not-a-token" } })
    ).status(),
  ).toBe(401);
});

test("the directory provisions somebody", async () => {
  const response = await api.post(SCIM, {
    headers: authed(),
    data: {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      externalId: "okta-e2e-0001",
      userName: ADDRESS,
      name: { givenName: "Grace", familyName: "Hopper" },
      emails: [{ value: ADDRESS, primary: true, type: "work" }],
      active: true,
    },
  });

  expect(response.status()).toBe(201);
  const created = await response.json();
  expect(created.userName).toBe(ADDRESS);
  expect(created.active).toBe(true);
  memberId = created.id;
});

test("sending the same person again creates nobody new", async () => {
  const response = await api.post(SCIM, {
    headers: authed(),
    data: {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      externalId: "okta-e2e-0001",
      userName: ADDRESS,
      emails: [{ value: ADDRESS, primary: true, type: "work" }],
    },
  });

  // 200 rather than 201: nothing was created.
  expect(response.status()).toBe(200);
  expect((await response.json()).id).toBe(memberId);
});

test("the provider looks somebody up the way it actually does", async () => {
  const filtered = await api.get(
    `${SCIM}?filter=${encodeURIComponent(`userName eq "${ADDRESS}"`)}`,
    { headers: authed() },
  );
  expect(filtered.status()).toBe(200);
  const list = await filtered.json();
  expect(list.totalResults).toBe(1);
  expect(list.Resources[0].id).toBe(memberId);

  const unknown = await api.get(
    `${SCIM}?filter=${encodeURIComponent('userName eq "nobody@directory.test"')}`,
    { headers: authed() },
  );
  expect((await unknown.json()).totalResults).toBe(0);

  // A filter this surface cannot read is refused rather than answered with
  // everybody, which a provider would read as a match.
  const unsupported = await api.get(
    `${SCIM}?filter=${encodeURIComponent('displayName co "Grace"')}`,
    { headers: authed() },
  );
  expect(unsupported.status()).toBe(400);
});

test("the person appears in the workspace, as a member", async () => {
  await goTo(page, "/people");
  // By the name the directory sent, which is what the list shows: a member's
  // address is theirs and the roster is not where it is published.
  await expect(page.getByText("Grace Hopper").first()).toBeVisible({
    timeout: 10_000,
  });
});

test("a group becomes a space with that membership", async () => {
  const response = await api.post("/api/scim/v2/Groups", {
    headers: authed(),
    data: {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      externalId: "okta-group-e2e",
      displayName: "Directory Engineering",
      members: [{ value: memberId }],
    },
  });

  expect(response.status()).toBe(201);
  const group = await response.json();
  expect(group.displayName).toBe("Directory Engineering");
  expect(group.members).toHaveLength(1);
  groupId = group.id;

  // The space is a real one, and the browser can see it.
  await goTo(page, "/spaces");
  await expect(page.getByText("Directory Engineering").first()).toBeVisible({
    timeout: 10_000,
  });
});

test("a member removed from the group leaves the space", async () => {
  const response = await api.patch(`/api/scim/v2/Groups/${groupId}`, {
    headers: authed(),
    data: {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [
        { op: "remove", path: `members[value eq "${memberId}"]` },
      ],
    },
  });

  expect(response.status()).toBe(200);
  expect((await response.json()).members).toHaveLength(0);

  // Out of the space, still in the workspace: the Users resource is what
  // decides that, and it was not asked.
  const user = await api.get(`${SCIM}/${memberId}`, { headers: authed() });
  expect(user.status()).toBe(200);
});

test("deleting the group leaves the space standing", async () => {
  const deleted = await api.delete(`/api/scim/v2/Groups/${groupId}`, {
    headers: authed(),
  });
  expect(deleted.status()).toBe(204);

  expect(
    (await api.get(`/api/scim/v2/Groups/${groupId}`, { headers: authed() })).status(),
  ).toBe(404);

  // A directory deleting a group is a statement about who works together,
  // not permission to put a workspace's work out of reach.
  await goTo(page, "/spaces");
  await expect(page.getByText("Directory Engineering").first()).toBeVisible({
    timeout: 10_000,
  });
});

test("removing them from the directory suspends them", async () => {
  const response = await api.patch(`${SCIM}/${memberId}`, {
    headers: authed(),
    data: {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: [{ op: "replace", value: { active: false } }],
    },
  });

  expect(response.status()).toBe(200);
  expect((await response.json()).active).toBe(false);

  // And the workspace agrees, which is the half a 200 does not prove.
  const read = await api.get(`${SCIM}/${memberId}`, { headers: authed() });
  expect((await read.json()).active).toBe(false);
});

test("a delete suspends rather than erases", async () => {
  const restored = await api.patch(`${SCIM}/${memberId}`, {
    headers: authed(),
    data: { schemas: [], Operations: [{ op: "replace", path: "active", value: true }] },
  });
  expect((await restored.json()).active).toBe(true);

  const deleted = await api.delete(`${SCIM}/${memberId}`, {
    headers: authed(),
  });
  expect(deleted.status()).toBe(204);

  // Still there, and suspended. A directory believing it deleted somebody and
  // a workspace keeping what they wrote are both satisfied by this.
  const read = await api.get(`${SCIM}/${memberId}`, { headers: authed() });
  expect(read.status()).toBe(200);
  expect((await read.json()).active).toBe(false);
});

test("a new token replaces the old one", async () => {
  await goTo(page, "/admin/directory");
  await page.getByRole("button", { name: "Generate SCIM token" }).click();
  await expect(page.getByTestId("scim-token")).toBeVisible({ timeout: 10_000 });

  // The one this file has been using is now dead, which is what "one live
  // token per workspace" has to mean to be worth anything.
  expect((await api.get(SCIM, { headers: authed() })).status()).toBe(401);
});
