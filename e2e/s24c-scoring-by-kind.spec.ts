/**
 * The scoring reveal, by kind (P9-T11b-b, METHOD.md §3.3 and §3.4).
 *
 * Acceptance A6 (docs/design/adaptable-practice.md):
 *   Given a committed key result scored 1.0, when the scoring reveal runs,
 *   then no "too safe" note appears, and a committed key result at 0.8 asks
 *   for its explanation.
 *
 * The review is built through the API in a space of its own, so its grades
 * and its objective sit beside nothing another spec counts, and the screen is
 * what is asserted. It leaves what it found: the review is closed, the
 * objective deleted and the space archived, whatever happened.
 */
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now().toString(36);
const SPACE = `Kind review ${STAMP}`;
const OBJECTIVE = "Answer every enterprise ticket inside one working day";
const KEPT = "Enterprise first response under four hours, from 9 to 4";
const MISSED = "Enterprise tickets closed in a day, from 60% to 95%";

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";
let spaceId = "";
let goalId = "";
let sessionId = "";

const authed = () => ({ authorization: `Bearer ${token}` });

async function post<T>(action: string, data: unknown): Promise<T> {
  const response = await api.post(`/api/v1/${action.replace(".", "/")}`, {
    headers: authed(),
    data,
  });
  expect(response.status(), `${action} answered`).toBe(200);
  return (await response.json()).data as T;
}

async function get<T>(path: string): Promise<T> {
  const response = await api.get(`/api/v1/${path}`, { headers: authed() });
  expect(response.status(), `${path} answered`).toBe(200);
  return (await response.json()).data as T;
}

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  if (token) {
    if (sessionId) {
      await api.post("/api/v1/sessions/close", {
        headers: authed(),
        data: { id: sessionId },
      });
    }
    if (goalId) {
      const deleted = await api.post("/api/v1/goals/delete", {
        headers: authed(),
        data: { id: goalId },
      });
      expect(deleted.status()).toBe(200);
    }
    if (spaceId) {
      await api.post("/api/v1/spaces/archive", {
        headers: authed(),
        data: { id: spaceId },
      });
    }
  }
  await api?.dispose();
  await context?.close();
});

test("sign in, with a token for building the review", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Scoring by kind e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("checkbox", { name: "Destructive" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();
});

test("a committed objective, graded 1.0 and 0.8 and revealed", async () => {
  const directory = await get<{ id: string; name: string }[]>(
    "people/directory",
  );
  const me = directory.find((member) => member.name === INSTANCE_ACCOUNT.name);
  expect(me, "the signed-in account is in the directory").toBeTruthy();
  const cycle = await get<{ id: string }>("cycles/current?mode=quarterly");

  spaceId = (await post<{ id: string }>("spaces.create", { name: SPACE })).id;
  goalId = (
    await post<{ id: string }>("goals.create", {
      title: OBJECTIVE,
      cycleId: cycle.id,
      spaceId,
      level: "team",
      ownerKind: "space",
      kind: "committed",
    })
  ).id;
  const keyResultIds: string[] = [];
  for (const title of [KEPT, MISSED]) {
    keyResultIds.push(
      (
        await post<{ id: string }>("goals.addKeyResult", {
          goalId,
          title,
          direction: "increase",
          indicatorType: "lagging",
          baselineValue: 0,
          targetValue: 100,
        })
      ).id,
    );
  }

  sessionId = (
    await post<{ id: string }>("sessions.create", {
      spaceId,
      cycleId: cycle.id,
      kind: "quarterly",
      title: `Q review ${STAMP}`,
      scheduledFor: new Date().toISOString(),
      facilitatorId: me?.id,
    })
  ).id;
  await post("sessions.open", { id: sessionId });
  // Stage two, the scoring reveal (§8.3).
  await post("sessions.advanceStage", { id: sessionId });
  await post("sessions.scoreKeyResult", {
    sessionId,
    keyResultId: keyResultIds[0],
    score: 1,
    reason: "Four hours, every week of the quarter.",
  });
  await post("sessions.scoreKeyResult", {
    sessionId,
    keyResultId: keyResultIds[1],
    score: 0.8,
    reason: "Eighty per cent closed in a day.",
  });
  await post("sessions.revealObjectiveScore", { sessionId, goalId });
});

test("acceptance A6: no too-safe note on the commitment kept, and the miss asks for its explanation", async () => {
  await goTo(page, `/session/${sessionId}`);
  await expect(page.getByText(/Stage 2 of 11/)).toBeVisible({
    timeout: 15_000,
  });

  const kept = page.getByRole("listitem").filter({ hasText: KEPT });
  const missed = page.getByRole("listitem").filter({ hasText: MISSED });
  await expect(kept).toBeVisible();
  await expect(kept.getByText("Committed", { exact: true })).toBeVisible();
  await expect(kept.getByTestId("score-note")).toHaveCount(0);
  await expect(missed.getByTestId("score-note")).toHaveText(
    "Write the short explanation of the miss",
  );

  // §3.4: a committed set is the share met, not an average with a verdict,
  // and a commitment met in full is never called too safe.
  await expect(page.getByText("Committed: 1 of 2 met")).toBeVisible();
  await expect(page.getByTestId("too-safe")).toHaveCount(0);
});
