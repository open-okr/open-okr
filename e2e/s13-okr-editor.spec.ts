/**
 * The editable OKR set on S-13 — P8-G12.
 *
 * Acceptance criteria:
 *   Given a member with edit rights, when they press Add objective on the OKR
 *   screen, then the objective is created in the cycle on screen and appears
 *   without leaving it.
 *
 *   Given an objective on that screen, when they press Add key result and
 *   name it, then the key result is created under that objective.
 *
 *   Given a key result with a value, when they type a new value in the table,
 *   then the value is recorded and the progress beside it moves.
 *
 *   Given the Diagram tab, when it is opened, then the same cycle is drawn
 *   with its objectives and their key results.
 *
 *   Given the list open in two tabs, when a title is changed in one, then
 *   the other shows it without a reload (P9-T06c).
 *
 *   Given a key result in the list, when its owner changes the title, value
 *   and due date with the keyboard alone, then each saves on Enter and shows
 *   after a reload (P9-T07a-a). Easing its target asks why (U3), and a title
 *   changed since it was read is not overwritten (U6).
 *
 * **A browser proves what the action tests cannot**: that a value typed into
 * a cell reaches `goals.recordValue` and comes back as a different number on
 * the row, and that the add controls exist on the screen somebody is reading
 * rather than three navigations away, which is the whole complaint this work
 * answers.
 *
 * **The file name carries the run order:** specs run alphabetically against
 * one instance and `registration-to-dashboard.spec.ts` claims it, so anything
 * that signs in sorts after `registration-`.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

const OBJECTIVE = "Make onboarding something customers finish by themselves";
const KEY_RESULT = "Accounts reaching first value within seven days";

/**
 * Waits until a reload shows what was saved, which is when the server has it.
 *
 * The list changes the moment somebody types (P9-T06c), so a row on screen is
 * not evidence that the write landed. A case that navigates straight after an
 * edit can leave while the write is still on its way, and the next case then
 * meets the old value; that is how a removal and the Deleted items case after
 * it failed in continuous integration once the list became optimistic.
 */
async function persisted(check: () => Promise<void>): Promise<void> {
  await settled();
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout: 20_000 });
}

/**
 * Waits until no change is on its way to the server. A reload while one is
 * aborts it, and the next check then reads a value that was never saved.
 */
async function settled(): Promise<void> {
  await expect(
    page.locator("#main-content").getByTestId("okr-list"),
  ).toHaveAttribute("aria-busy", "false", { timeout: 15_000 });
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

test("sign in and open the OKR screen", async () => {
  await signIn(page);
  await goTo(page, "/goals");
  await expect(page.getByRole("group", { name: "Display" })).toBeVisible({
    timeout: 15_000,
  });
});

test("an objective is added without leaving the screen", async () => {
  const added = page.locator(
    `input[aria-label="Objective title"][value="${OBJECTIVE}"]`,
  );
  // Retry-safe: a retry runs this serial file from the top, and a second
  // objective with the same title would make every later locator ambiguous.
  if ((await added.count()) === 0) {
    await page.getByRole("button", { name: "Add objective" }).click();
    const field = page.getByRole("textbox", { name: "Add objective" });
    await field.fill(OBJECTIVE);
    await field.press("Enter");
  }

  // The row is an input carrying the title, so the assertion is on its value.
  await expect(added).toBeVisible({ timeout: 15_000 });
});

test("a key result is added under that objective", async () => {
  const added = page.locator(
    `input[aria-label="Key result title"][value="${KEY_RESULT}"]`,
  );
  if ((await added.count()) === 0) {
    // A new objective opens with one key result draft under it (P9-T07b-a);
    // the add row is pressed only when that draft is not there.
    const field = page.getByRole("textbox", { name: "Add key result" });
    if ((await field.count()) === 0) {
      await page.getByRole("button", { name: "Add key result" }).last().click();
    }
    await field.fill(KEY_RESULT);
    await field.press("Enter");
  }

  await expect(added).toBeVisible({ timeout: 15_000 });
});

/**
 * One cache for the list, and every tab on it (P9-T06c). The title is
 * changed in one tab and the other shows it without being reloaded, which is
 * the cache telling the other tab over the browser's own channel; another
 * member's change arrives on the workspace's live stream instead.
 */
test("a title changed in one tab shows in another without a reload", async () => {
  const other = await context.newPage();
  await goTo(other, "/goals");
  // Scoped to the page's own content: a screen being replaced can still be
  // in the document, hidden, while the new one renders, and an unscoped
  // locator then finds the title twice.
  const titled = (where: typeof page, value: string) =>
    where
      .locator("#main-content")
      .locator(`input[aria-label="Objective title"][value="${value}"]`);
  await expect(titled(other, OBJECTIVE)).toBeVisible({ timeout: 15_000 });

  const renamed = `${OBJECTIVE}, from the first tab`;
  try {
    // Enter on the keyboard rather than on the locator: the locator finds
    // the field by its value, which is no longer the old title once filled.
    await titled(page, OBJECTIVE).fill(renamed);
    await page.keyboard.press("Enter");
    // At once in this tab, and in the other without a navigation.
    await expect(titled(page, renamed)).toBeVisible({ timeout: 5_000 });
    await settled();
    // Brought forward as a person switching to it would be. A browser may
    // hold a background tab's work back, which is how this case failed in
    // continuous integration with every save already made.
    await other.bringToFront();
    await expect(titled(other, renamed)).toBeVisible({ timeout: 20_000 });
  } finally {
    // Back, whatever happened, so a retry and every later case meet the
    // title they expect rather than adding a second objective beside it.
    await page.bringToFront();
    if ((await titled(page, renamed).count()) > 0) {
      await titled(page, renamed).fill(OBJECTIVE);
      await page.keyboard.press("Enter");
      await settled();
    }
    await other.close();
  }
});

test("a value typed into the table is recorded and moves the progress", async () => {
  const value = page.getByRole("spinbutton", {
    name: `Current value for ${KEY_RESULT}`,
  });
  await expect(value).toHaveValue("0");
  await value.fill("40");
  await value.press("Enter");

  // 40 of a 100 target, recorded through the same action a check-in uses.
  await expect(value).toHaveValue("40", { timeout: 15_000 });
  await expect(page.getByText("40%").first()).toBeVisible();
});

/**
 * Every cell of a key result, with the keyboard alone (P9-T07a-a acceptance).
 * Each field is reached, typed into and committed with Enter, and all three
 * are still there after a reload, which is the claim that matters: a cell that
 * looks saved and is not is the defect this list exists to avoid.
 */
test("a key result's title, value and due date change with the keyboard alone, and stay after a reload", async () => {
  await goTo(page, "/goals");
  const retitled = `${KEY_RESULT}, measured weekly`;

  const title = page.locator(
    `input[aria-label="Key result title"][value="${KEY_RESULT}"]`,
  );
  await title.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(retitled);
  await page.keyboard.press("Enter");

  const value = page.getByRole("spinbutton", {
    name: `Current value for ${retitled}`,
  });
  await expect(value).toBeVisible({ timeout: 15_000 });
  await value.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("55");
  await page.keyboard.press("Enter");

  const due = page.getByLabel(`Due date for ${retitled}`);
  await due.focus();
  await due.fill("2030-03-31");
  await page.keyboard.press("Enter");

  await settled();
  await expect(async () => {
    await page.reload();
    await expect(
      page.locator(`input[aria-label="Key result title"][value="${retitled}"]`),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole("spinbutton", { name: `Current value for ${retitled}` }),
    ).toHaveValue("55");
    await expect(page.getByLabel(`Due date for ${retitled}`)).toHaveValue(
      "2030-03-31",
    );
  }).toPass({ timeout: 20_000 });

  // Back to the title every later case in this file names.
  const back = page.locator(
    `input[aria-label="Key result title"][value="${retitled}"]`,
  );
  await back.fill(KEY_RESULT);
  await page.keyboard.press("Enter");
  await persisted(() =>
    expect(
      page.locator(
        `input[aria-label="Key result title"][value="${KEY_RESULT}"]`,
      ),
    ).toBeVisible({ timeout: 5_000 }),
  );
});

/**
 * U3: easing a target asks why, under the cell, before anything is sent; with
 * a reason it saves. That the server refuses an easing without one, from every
 * surface, is proved in `packages/core/test/goal-targets.test.ts`.
 */
test("easing a target asks why, and saves with the reason", async () => {
  await goTo(page, "/goals");
  const target = page.getByRole("spinbutton", {
    name: `Target for ${KEY_RESULT}`,
  });
  await expect(target).toHaveValue("100", { timeout: 15_000 });
  await target.fill("80");
  await page.keyboard.press("Enter");

  const reason = page.getByTestId("target-reason");
  await expect(reason).toContainText("Easing the target from 100 to 80");
  await reason
    .getByRole("textbox")
    .fill("The partner channel we counted on closed in week three");
  await page.keyboard.press("Enter");
  await expect(reason).toHaveCount(0);

  await settled();
  await expect(async () => {
    await page.reload();
    await expect(
      page.getByRole("spinbutton", { name: `Target for ${KEY_RESULT}` }),
    ).toHaveValue("80", { timeout: 5_000 });
  }).toPass({ timeout: 20_000 });
});

/**
 * U6: two people, one title. The other write goes through the REST surface as
 * this same member, which the live stream deliberately does not announce to
 * them and no other tab hears, so the list is holding exactly the stale read
 * the conflict refusal exists for. Nothing is overwritten, the screen says
 * what the title now reads, and taking theirs shows it.
 */
test("a title changed since it was read is not overwritten", async ({
  playwright,
  baseURL,
}) => {
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("OKR list conflict e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  const token = ((await shown.textContent()) ?? "").trim();
  const api = await playwright.request.newContext({ baseURL });
  const headers = { authorization: `Bearer ${token}` };

  try {
    await goTo(page, "/goals");
    const field = (value: string) =>
      page.locator(`input[aria-label="Objective title"][value="${value}"]`);
    await expect(field(OBJECTIVE)).toBeVisible({ timeout: 15_000 });

    const listed = await api.get("/api/v1/goals/list", { headers });
    const goal = (
      (await listed.json()).data.goals as { id: string; title: string }[]
    ).find((row) => row.title === OBJECTIVE);
    expect(goal).toBeTruthy();
    const theirs = `${OBJECTIVE}, as somebody else put it`;
    const patched = await api.post("/api/v1/goals/patch", {
      headers,
      data: {
        id: goal?.id,
        set: { title: theirs },
        read: { title: OBJECTIVE },
      },
    });
    expect(patched.status()).toBe(200);

    // The list still shows the title it read, and this edit is made from it.
    await field(OBJECTIVE).fill(`${OBJECTIVE}, as I put it`);
    await page.keyboard.press("Enter");
    const conflict = page.getByTestId("okr-conflict");
    await expect(conflict).toContainText(theirs, { timeout: 15_000 });

    await conflict.getByRole("button", { name: "Take theirs" }).click();
    await expect(field(theirs)).toBeVisible({ timeout: 15_000 });
    await expect(conflict).toHaveCount(0);

    // Back to the title the rest of this file names.
    await field(theirs).fill(OBJECTIVE);
    await page.keyboard.press("Enter");
    await persisted(() =>
      expect(field(OBJECTIVE)).toBeVisible({ timeout: 5_000 }),
    );
  } finally {
    await api.dispose();
  }
});

/**
 * The scope tabs and the filters, each kept in the address (P9-T07a-b). The
 * objective this file added is the reader's own and sits in no space, so My
 * team and Company leave it out and Mine and its champion keep it.
 */
test("the scope tabs and filters narrow the list, and the address keeps them", async () => {
  await goTo(page, "/goals");
  const ours = page.locator(
    `input[aria-label="Objective title"][value="${OBJECTIVE}"]`,
  );
  await expect(ours).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("okr-summary")).toContainText("Objectives:");
  const scope = page.getByRole("group", { name: "Scope" });
  // The level chips offer only the levels this cycle uses (P9-T07a-c), and
  // individual OKRs are off by default.
  const levels = page.locator("#main-content").getByRole("group", {
    name: "Level",
  });
  await expect(levels.getByRole("link", { name: "team" })).toBeVisible();
  await expect(levels.getByRole("link", { name: "individual" })).toHaveCount(0);

  await scope.getByRole("link", { name: "My team" }).click();
  await expect(page).toHaveURL(/scope=team/);
  await expect(ours).toHaveCount(0, { timeout: 15_000 });

  await scope.getByRole("link", { name: "Company" }).click();
  await expect(page).toHaveURL(/scope=company/);
  await expect(ours).toHaveCount(0, { timeout: 15_000 });

  await scope.getByRole("link", { name: "Mine" }).click();
  await expect(page).toHaveURL(/mine=1/);
  await expect(page).not.toHaveURL(/scope=/);
  await expect(ours).toBeVisible({ timeout: 15_000 });

  // A champion is a select, and choosing one is a navigation like a tab.
  await scope.getByRole("link", { name: "All" }).click();
  // Scoped to the page's own content: the screen just left can still be in
  // the document, hidden, while the next one renders.
  const champion = page
    .locator("#main-content")
    .getByLabel("Champion", { exact: true });
  const me = await page
    .locator(`input[aria-label="Objective title"][value="${OBJECTIVE}"]`)
    .first()
    .locator("xpath=ancestor::div[contains(@class, 'grid')][1]")
    .getByLabel(`Champion of ${OBJECTIVE}`)
    .evaluate((select) => (select as HTMLSelectElement).value);
  await champion.selectOption(me);
  await expect(page).toHaveURL(new RegExp(`champion=${me}`));
  await expect(ours).toBeVisible({ timeout: 15_000 });

  await goTo(page, "/goals");
});

/**
 * The cycle picker's links carry a cycle (P9-T07a-b). Its address template
 * was built on the server from a constant exported by a client component,
 * which reaches the server as a reference rather than a string, so since
 * P8-G12 every cycle it listed linked to an address with a stringified
 * function where the cycle should be.
 */
test("the cycle picker lists cycles that open", async () => {
  await goTo(page, "/goals");
  await page
    .locator("#main-content")
    .locator('button[aria-haspopup="listbox"]')
    .click();
  const first = page.locator('#main-content ul a[href*="cycle="]').first();
  await expect(first).toHaveAttribute(
    "href",
    /\/goals\?cycle=[0-9a-f-]{36}(&|$)/,
  );
  await first.click();
  await expect(page).toHaveURL(/\/goals\?cycle=[0-9a-f-]{36}/);
  // The first cycle listed need not be the one this file wrote into.
  await goTo(page, "/goals");
});

test("the diagram draws the same cycle", async () => {
  await page.getByRole("link", { name: "Diagram", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Collapse all" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: OBJECTIVE })).toBeVisible();
});

test("a member can take the key result back off the set", async () => {
  await goTo(page, "/goals");
  await page
    .getByRole("button", { name: "Delete this key result" })
    .last()
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(
    page.locator(`input[aria-label="Key result title"][value="${KEY_RESULT}"]`),
  ).toHaveCount(0, { timeout: 15_000 });
  // The row goes at once; the toast is the server's answer, and what the next
  // case reads is only there once it has given it.
  await expect(
    page.getByTestId("toast").filter({ hasText: "Key result removed" }),
  ).toBeVisible({ timeout: 15_000 });
});

/**
 * A key result removed on its own comes back from Deleted items (P9-T06b).
 * Until then only a deleted objective could, and a key result taken off a
 * set was gone for good, whatever the delete control's sentence promised.
 */
test("and Deleted items lists it with who removed it, and brings it back", async () => {
  await goTo(page, "/admin/deleted");
  const row = page
    .getByTestId("deleted-item")
    .filter({ hasText: `${KEY_RESULT} (${OBJECTIVE})` });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText("Key result");
  await expect(row).toContainText("Deleted by");

  await row
    .getByRole("button", { name: `Restore "${KEY_RESULT} (${OBJECTIVE})"` })
    .click();
  await expect(
    page.getByTestId("toast").filter({ hasText: "Key result restored." }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(row).toHaveCount(0, { timeout: 15_000 });

  await goTo(page, "/goals");
  await expect(
    page.locator(`input[aria-label="Key result title"][value="${KEY_RESULT}"]`),
  ).toBeVisible({ timeout: 15_000 });

  // And off again, so every later spec meets the set it met before.
  await page
    .getByRole("button", { name: "Delete this key result" })
    .last()
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByTestId("toast").filter({ hasText: "Key result removed" }),
  ).toBeVisible({ timeout: 15_000 });
});
