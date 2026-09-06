/**
 * Screen S-40: connecting an external agent, end to end (P5-T08c).
 *
 * Acceptance criterion:
 *   Given a user whose refresh token was replayed by a client, when they open
 *   their connections list, then the grant is shown as revoked, the reason is
 *   named, and no token in the lineage works.
 *
 * This is a spec rather than a unit test because the flow is a browser and an
 * HTTP client taking turns. A person signs in and approves; the browser is
 * redirected to an address the client owns, carrying a code; the client redeems
 * that code over HTTP with no cookie at all. Nothing but a real run proves those
 * three hand-offs line up.
 *
 * What each part decides is proved against a real database in
 * `packages/core/test/oauth-consent.test.ts`.
 */
import { createHash, randomBytes } from "node:crypto";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { goTo, signIn } from "./instance-account.ts";

/**
 * A client's own callback. Nothing in this suite listens there, and nothing
 * needs to: what the protocol promises is the *redirect*, and these tests read
 * it off the 303 rather than following it. The browser then lands on a dead
 * address, which is exactly what happens when an agent has stopped listening,
 * and says nothing either way about whether the code was issued correctly.
 */
const REDIRECT = "http://127.0.0.1:7777/callback";

const STATE = "state-from-the-client";

/** The address the decision handler answers with, read off its own response. */
async function answerFor(
  target: Page,
  press: "Connect" | "Refuse",
): Promise<URL> {
  const [response] = await Promise.all([
    target.waitForResponse(
      (candidate) =>
        candidate.url().includes("/oauth/authorize/decide") &&
        candidate.status() === 303,
      { timeout: 15_000 },
    ),
    target.getByRole("button", { name: press }).click(),
  ]);
  const location = response.headers().location ?? "";
  return new URL(location);
}

const verifier = randomBytes(48).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let code = "";
let refreshToken = "";
let accessToken = "";

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();

  // No cookies: a client redeeming a code has none, by definition.
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  await api?.dispose();
  await context?.close();
});

const authoriseUrl = (over: Record<string, string> = {}): string => {
  const params = new URLSearchParams({
    client_id: "openokr-cli",
    redirect_uri: REDIRECT,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "read write",
    state: STATE,
    ...over,
  });
  return `/oauth/authorize?${params.toString()}`;
};

test("the consent screen names the agent and what it will be able to do", async () => {
  await signIn(page);
  await goTo(page, authoriseUrl());

  await expect(
    page.getByRole("heading", { level: 1, name: "Connect an agent" }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("The OpenOKR command line")).toBeVisible();

  // What was asked for, listed as what it means rather than as scope names
  // alone. Two, because the request asked for two.
  await expect(page.getByTestId("consent-scope")).toHaveCount(2);
  await expect(page.getByText("Read anything you can read")).toBeVisible();
});

test("an unknown client is shown to the person, not bounced to the address", async () => {
  // Bouncing this would hand the error, and the request's state, to whoever
  // supplied the address.
  await goTo(page, authoriseUrl({ client_id: "not-a-client" }));
  await expect(
    page.getByText(/does not know that client/i),
  ).toBeVisible({ timeout: 10_000 });
  expect(page.url()).toContain("/oauth/authorize");
});

test("approving redirects to the client's own address with a code (acceptance, part one)", async () => {
  await goTo(page, authoriseUrl());
  await expect(
    page.getByRole("heading", { level: 1, name: "Connect an agent" }),
  ).toBeVisible({ timeout: 10_000 });

  const landed = await answerFor(page, "Connect");
  expect(landed.origin).toBe("http://127.0.0.1:7777");
  // The client's own value, echoed exactly: its whole purpose is that the
  // client recognises it.
  expect(landed.searchParams.get("state")).toBe(STATE);

  code = landed.searchParams.get("code") ?? "";
  expect(code).toMatch(/^okr_code_/);
});

test("the client redeems that code over HTTP, with no session", async () => {
  const response = await api.post("/api/mcp/token", {
    form: {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
    },
  });

  expect(response.status()).toBe(200);
  const tokens = (await response.json()) as Record<string, string>;
  expect(tokens.token_type).toBe("Bearer");
  expect(tokens.scope).toBe("read write");

  accessToken = tokens.access_token as string;
  refreshToken = tokens.refresh_token as string;
  expect(accessToken).toMatch(/^okr_at_/);
  expect(refreshToken).toMatch(/^okr_rt_/);
});

test("the connection appears in the person's own list", async () => {
  await goTo(page, "/account/connections");
  await expect(
    page.getByRole("heading", { level: 1, name: "Connected agents" }),
  ).toBeVisible({ timeout: 10_000 });

  const connection = page.getByTestId("connection").first();
  await expect(connection).toContainText("The OpenOKR command line");
  await expect(connection).toContainText("active");
});

test("a replayed refresh token revokes the lineage (acceptance, part two)", async () => {
  // One legitimate rotation, which is what a client does an hour later.
  const rotated = await api.post("/api/mcp/token", {
    form: { grant_type: "refresh_token", refresh_token: refreshToken },
  });
  expect(rotated.status()).toBe(200);
  const newer = (await rotated.json()) as Record<string, string>;

  // And now the copy somebody else kept.
  const replay = await api.post("/api/mcp/token", {
    form: { grant_type: "refresh_token", refresh_token: refreshToken },
  });
  expect(replay.status()).toBe(400);

  // The newest token is dead too, which is the whole point: whoever copied one
  // holds whatever the client holds.
  const afterwards = await api.post("/api/mcp/token", {
    form: { grant_type: "refresh_token", refresh_token: newer.refresh_token },
  });
  expect(afterwards.status()).toBe(400);
});

test("the list says it was revoked, and why (acceptance)", async () => {
  await goTo(page, "/account/connections");
  const connection = page.getByTestId("connection").first();

  await expect(connection).toContainText("revoked", { timeout: 10_000 });
  await expect(page.getByTestId("revoked-reason").first()).toContainText(
    "presented twice",
  );
});

test("refusing sends the client a denial rather than leaving it waiting", async () => {
  await goTo(page, authoriseUrl({ state: "second-request" }));
  await expect(
    page.getByRole("heading", { level: 1, name: "Connect an agent" }),
  ).toBeVisible({ timeout: 10_000 });

  const landed = await answerFor(page, "Refuse");
  expect(landed.searchParams.get("error")).toBe("access_denied");
  expect(landed.searchParams.get("state")).toBe("second-request");
  expect(landed.searchParams.has("code")).toBe(false);
});
