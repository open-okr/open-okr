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
import { choose } from "./pickers.ts";

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

/**
 * Live agent run streams (PLAN.md §7, release 0.7.0 A11).
 *
 * Given the agents screen is open, when a run is started over the API and the
 * relay carries it to its end, then the run appears and its stop is shown
 * without the reader navigating. The marker on `window` is what proves no
 * navigation: a reload would have cleared it, and `router.refresh()` does not.
 */
test("the agents screen shows a run start and stop without a reload", async () => {
  const listed = await api.get("/api/v1/spaces/list", { headers: authed() });
  const spaceId = ((await listed.json()).data as { id: string }[])[0]
    ?.id as string;
  const created = await api.post("/api/v1/agents/create", {
    headers: authed(),
    data: { name: "E2E live runner" },
  });
  expect(created.status()).toBe(200);
  const agentId = (await created.json()).data.id as string;
  await api.post("/api/v1/agents/bindScope", {
    headers: authed(),
    data: { agentId, resourceType: "space", resourceId: spaceId, level: 70 },
  });

  // Listening before the run starts, or both its events could pass a page
  // that has not opened its stream yet.
  const listening = page.waitForResponse(
    (response) =>
      response.url().includes("/api/agents/live") && response.status() === 200,
  );
  await goTo(page, "/admin/agents");
  await listening;
  await page.evaluate(() => {
    (window as unknown as { stayed?: boolean }).stayed = true;
  });
  const run = page
    .getByRole("listitem")
    .filter({ hasText: "E2E live runner" })
    .filter({ hasText: "Steps done" });
  await expect(run).toHaveCount(0);

  const started = await api.post("/api/v1/agents/startRun", {
    headers: authed(),
    data: {
      agentId,
      trigger: "e2e-live",
      tasks: [
        {
          action: "spaces.update",
          input: { id: spaceId, name: "Renamed live" },
          subjectType: "space",
          subjectId: spaceId,
        },
      ],
    },
  });
  expect(started.status()).toBe(200);

  // No goTo from here: the stream is the only thing that can move the page.
  await expect(run.getByText("cancelled", { exact: true })).toBeVisible({
    timeout: 45_000,
  });
  await expect(run).toContainText("no AI provider is configured");
  expect(
    await page.evaluate(
      () => (window as unknown as { stayed?: boolean }).stayed,
    ),
  ).toBe(true);
});

/**
 * guided-inputs §4.10: a scope names a goal by finding it, where its id was
 * pasted from the goal's own page. Goals are searched rather than listed,
 * since a workspace can hold tens of thousands. Bound to this file's own
 * agent, so the seeded two are left as every later spec expects them.
 */
test("a scope names a goal found by typing, not a pasted id", async () => {
  const goals = await api.get("/api/v1/goals/list", { headers: authed() });
  expect(goals.status()).toBe(200);
  const goal = ((await goals.json()).data.goals as { title: string }[])[0];
  expect(goal).toBeTruthy();
  const title = goal?.title as string;

  await goTo(page, "/admin/agents");
  const runner = page.getByRole("listitem").filter({ hasText: "E2E runner" }).first();
  await runner.getByRole("button", { name: "Bind a scope" }).click();
  await runner.locator("select[name='resourceType']").selectOption("goal");
  await choose(runner.getByLabel("Which one"), title);
  await runner.getByRole("button", { name: "Bind", exact: true }).click();

  // The form closes only when the binding is saved, and says why otherwise.
  await expect(
    runner.getByRole("button", { name: "Bind a scope" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(runner.getByRole("alert")).toHaveCount(0);
});

/**
 * docs/design/agent-faces.md §6: each agent wears its own face, a halted run's
 * agent is asleep, and the general face follows the theme the reader chose
 * rather than the system's, which an `<img>` of the drawing could not.
 */
test("each agent wears its own face, and the general one follows the theme", async () => {
  await goTo(page, "/admin/agents");
  const agents = page.getByRole("list", { name: "The agents" });
  const faceOf = (name: string) =>
    agents
      .getByRole("listitem")
      .filter({ hasText: name })
      .first()
      .locator("svg.agent-face")
      .first();
  await expect(faceOf("OKR Coach")).toHaveAttribute("data-agent", "coach");
  await expect(faceOf("OKR Champion")).toHaveAttribute(
    "data-agent",
    "champion",
  );
  await expect(faceOf("E2E runner")).toHaveAttribute("data-agent", "agent");

  // The first test's run stopped for want of a provider: a halt, not a failure.
  const run = page
    .getByRole("listitem")
    .filter({ hasText: "E2E runner" })
    .filter({ hasText: "Steps done" });
  await expect(run.locator("svg.agent-face").first()).toHaveAttribute(
    "data-mood",
    "sleeping",
  );

  // The navigation's face is the general one, with eyes of the surface token.
  const eye = page
    .locator('a[href="/admin/agents"] svg.agent-face .af-white')
    .first();
  const fill = () => eye.evaluate((element) => getComputedStyle(element).fill);
  const theme = (value: string) =>
    page.evaluate((next) => {
      document.documentElement.dataset.theme = next;
    }, value);

  await theme("light");
  expect(await fill()).toBe("rgb(255, 255, 255)");
  await theme("dark");
  expect(await fill()).toBe("rgb(17, 24, 39)");
  await theme("light");

  // Idle is the one mood that always moves: each eye glances on a six-second
  // loop and blinks on a separate 4.6-second one, with nobody hovering.
  const loops = await page
    .locator('a[href="/admin/agents"] svg.agent-face')
    .first()
    .evaluate((svg) =>
      svg
        .getAnimations({ subtree: true })
        .map((animation) => {
          const timing = animation.effect?.getComputedTiming();
          return `${(animation as CSSAnimation).animationName} ${timing?.duration} ${timing?.iterations}`;
        })
        .sort(),
    );
  expect(loops).toEqual([
    "af-blink 4600 Infinity",
    "af-blink 4600 Infinity",
    "af-look 6000 Infinity",
    "af-look 6000 Infinity",
  ]);
});
