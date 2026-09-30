/**
 * A custom agent's run moves on its own, and the agents screen says where it
 * got to (completeness review M-11).
 *
 * Acceptance criterion:
 *   Given a custom agent bound to one space, when a run is started for it over
 *   the API, then the relay takes its first step without anybody asking, and
 *   the run's state, its progress and the reason it stopped are on the agents
 *   screen.
 *
 * **This instance has no AI provider, and that is the path proved here.** A
 * custom agent has no deterministic form, so on this instance its run ends at
 * its first step, cancelled, with the reason written on it, and the space is
 * not renamed. What the run does with a provider, and every write policy, is
 * proved against a real database with the mock provider in
 * `packages/agents/test/custom-agent-runs.test.ts`. What only a running server
 * can show is that nothing but the relay moved the run.
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

const authed = () => ({ authorization: `Bearer ${token}` });

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  // No cookies, so every call below is the token's and nothing else's.
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  await api?.dispose();
  await context?.close();
});

test("a run started over the API is carried by the relay, and stops with its reason on screen", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Agent run e2e");
  await expect(page.getByRole("checkbox", { name: /^Read/ })).toBeChecked();
  await page.getByRole("checkbox", { name: /^Write/ }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  const listed = await api.get("/api/v1/spaces/list", { headers: authed() });
  expect(listed.status()).toBe(200);
  const spaces = (await listed.json()).data as { id: string; name: string }[];
  const space = spaces[0];
  expect(space).toBeTruthy();
  const spaceId = space?.id as string;
  const spaceName = space?.name as string;

  const created = await api.post("/api/v1/agents/create", {
    headers: authed(),
    data: { name: "E2E runner" },
  });
  expect(created.status()).toBe(200);
  const agentId = (await created.json()).data.id as string;

  const bound = await api.post("/api/v1/agents/bindScope", {
    headers: authed(),
    data: { agentId, resourceType: "space", resourceId: spaceId, level: 70 },
  });
  expect(bound.status()).toBe(200);

  const started = await api.post("/api/v1/agents/startRun", {
    headers: authed(),
    data: {
      agentId,
      trigger: "e2e",
      tasks: [
        {
          action: "spaces.update",
          input: { id: spaceId, name: "Renamed by an agent" },
          subjectType: "space",
          subjectId: spaceId,
        },
      ],
    },
  });
  expect(started.status()).toBe(200);
  expect((await started.json()).data.status).toBe("running");

  // Nothing here asks for the step. The relay polls the outbox, so the page is
  // read until the run has moved, rather than once.
  const run = page
    .getByRole("listitem")
    .filter({ hasText: "E2E runner" })
    .filter({ hasText: "Steps done" });
  await expect(async () => {
    await goTo(page, "/admin/agents");
    await expect(run.getByText("cancelled", { exact: true })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 45_000 });

  await expect(run).toContainText("Steps done: 0 of 1");
  await expect(run).toContainText("no AI provider is configured");

  // And the step it did not take left the space alone.
  const after = await api.get(`/api/v1/spaces/read?id=${spaceId}`, {
    headers: authed(),
  });
  expect((await after.json()).data.name).toBe(spaceName);
});
