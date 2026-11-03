/**
 * The practice settings screen (S-36, METHOD.md §12, P9-T05).
 *
 * An admin changes one setting on its card and the product obeys it at once:
 * "Who may write" set to the planning window holds a new objective back in a
 * quarter whose window is years away, the reason says so, and the audit trail
 * records the change. Then every §12.2 profile is applied from the profile
 * card in turn, with Lightweight's check-in frequency proved on the rhythm
 * card, because a profile's thresholds are written and its practice is not.
 * Last, the five are compared side by side in a dialog, the page links to the
 * method itself, and every setting, profile and row explains itself in place.
 *
 * **The practice is put back** after the last test, whatever happened,
 * because every later spec writes on the recommended profile. The policy
 * behind the refusal is proved for every caller in `s04c-binding-phases` and
 * `packages/core/test/policy-gate.test.ts`; this is the screen that sets it.
 */
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";
import { choose } from "./pickers.ts";

test.describe.configure({ mode: "serial" });

/** A quarter three years out, so its planning window has not opened. */
const ON = `${new Date().getUTCFullYear() + 3}-02-15`;

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";

const authed = () => ({ authorization: `Bearer ${token}` });

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  // Back to Recommended with nothing changed, so no later spec meets a
  // planning window or a profile this one chose.
  if (token) {
    await api.post("/api/v1/practice/applyProfile", {
      headers: authed(),
      data: { profile: "recommended" },
    });
    await api.post("/api/v1/practice/update", {
      headers: authed(),
      data: { overrides: { "writing.when": null } },
    });
  }
  await api?.dispose();
  await context?.close();
});

test("an admin limits writing to the planning window from its card", async () => {
  await signIn(page);
  // A token only for putting the practice back afterwards.
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Practice screen e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  await goTo(page, "/admin/practice");
  await expect(
    page.getByRole("heading", { level: 1, name: "Practice" }),
  ).toBeVisible({ timeout: 15_000 });
  // A setting is named in words. The section it comes from is the
  // specification's business, not the reader's.
  await expect(page.getByText("§")).toHaveCount(0);
  await expect(page.getByText("As the method").first()).toBeAttached();

  const card = page.getByTestId("practice-card-writing");
  const who = card.getByLabel("Who may write OKRs, and when", { exact: true });
  await expect(who).toHaveValue("anytime");
  await who.selectOption({ label: "Planning window" });
  await card.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved 1 setting.").first()).toBeVisible({
    timeout: 15_000,
  });
  // The card says the workspace now differs from its profile, and keeps the
  // value it saved rather than the one it first rendered.
  await expect(card.getByText("Differs from profile")).toBeVisible({
    timeout: 15_000,
  });
  await expect(who).toHaveValue("planningWindow");
});

test("a new objective outside the window is refused with the reason", async () => {
  // Retry-safe: the quarter is made once.
  const listed = await api.get("/api/v1/cycles/list", { headers: authed() });
  let cycleId = (
    (await listed.json()).data as {
      id: string;
      mode: string;
      startsOn: string;
      endsOn: string;
    }[]
  ).find(
    (cycle) =>
      cycle.mode === "quarterly" && cycle.startsOn <= ON && ON <= cycle.endsOn,
  )?.id;
  if (!cycleId) {
    const created = await api.post("/api/v1/cycles/create", {
      headers: authed(),
      data: { on: ON },
    });
    expect(created.status()).toBe(200);
    cycleId = (await created.json()).data.id as string;
  }

  await goTo(page, `/cycle?cycle=${cycleId}&phase=4`);
  await expect(
    page.getByText("does not let a new objective be written here now"),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText(/creates new objectives in the planning window, from/),
  ).toBeVisible();
});

test("the audit trail records the change", async () => {
  await goTo(page, "/admin/audit");
  await choose(page.getByLabel("Action", { exact: true }), "practice.update");
  await page.getByRole("button", { name: "Show matching rows" }).click();
  await expect(page.getByTestId("audit-row").first()).toContainText(
    "practice.update",
    { timeout: 15_000 },
  );
});

test("the card returns the setting to its profile", async () => {
  await goTo(page, "/admin/practice");
  const card = page.getByTestId("practice-card-writing");
  page.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "Reset to profile" }).click();
  await expect(
    page.getByText("Returned 1 setting to the profile.").first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(card.getByLabel("Who may write OKRs, and when", { exact: true })).toHaveValue(
    "anytime",
  );
});

test("every profile can be applied, and Lightweight moves the check-in frequency", async () => {
  const profileCard = page.getByTestId("practice-profile");
  for (const [profile, label] of [
    ["googleStyle", "Google-style"],
    ["radicalFocus", "Radical Focus"],
    ["lightweight", "Lightweight"],
    ["governed", "Governed"],
    ["recommended", "Recommended"],
  ] as const) {
    await goTo(page, "/admin/practice");
    await profileCard
      .getByRole("radio", { name: new RegExp(`^${label}`) })
      .check();
    // What it changes is shown before anything is written.
    await expect(page.getByTestId("practice-profile-preview")).toContainText(
      `Choosing ${label} changes`,
    );
    if (profile === "lightweight") {
      await expect(
        page.getByTestId("practice-profile-preview"),
      ).toContainText("Check-in frequency: weekly to biweekly");
    }
    await profileCard.getByRole("button", { name: "Use this profile" }).click();
    await expect(
      profileCard
        .getByRole("radio", { name: new RegExp(`^${label}\\s*In use`) })
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    if (profile === "lightweight") {
      await goTo(page, "/admin/rhythm");
      await expect(
        page.locator("select[name='defaultCheckInFrequency']"),
      ).toHaveValue("biweekly", { timeout: 15_000 });
    }
  }

  // Back on Recommended, the profile's threshold went back with it.
  await goTo(page, "/admin/rhythm");
  await expect(
    page.locator("select[name='defaultCheckInFrequency']"),
  ).toHaveValue("weekly", { timeout: 15_000 });
});

test("the five profiles compared side by side, and the method behind them", async () => {
  await goTo(page, "/admin/practice");
  // The whole method, as this release shipped it rather than as main reads.
  await expect(page.getByTestId("practice-method-link")).toHaveAttribute(
    "href",
    /\/blob\/v[^/]+\/docs\/specification\/METHOD\.md#12-practice-settings-and-profiles$/,
    { timeout: 15_000 },
  );

  const open = page.getByTestId("practice-compare-open");
  await open.click();
  const dialog = page.getByRole("dialog", {
    name: "The five profiles compared",
  });
  await expect(dialog).toBeVisible();
  const table = dialog.getByRole("table");
  for (const label of [
    "Recommended",
    "Google-style",
    "Radical Focus",
    "Lightweight",
    "Governed",
  ]) {
    await expect(
      table.getByRole("columnheader", { name: new RegExp(`^${label}`) }),
    ).toBeVisible();
  }
  // The profile this workspace runs is marked in its heading.
  await expect(
    table.getByRole("columnheader", { name: /^Recommended\s*In use/ }),
  ).toBeVisible();
  // One row read across, cell by cell.
  await expect(
    table.getByRole("row", { name: /^Phase enforcement/ }).getByRole("cell"),
  ).toHaveText(["Guided", "Guided", "Hidden", "Hidden", "Binding"]);
  await expect(
    table.getByRole("row", { name: /^Check-in frequency/ }).getByRole("cell"),
  ).toHaveText(["Weekly", "Weekly", "Weekly", "Every two weeks", "Weekly"]);
  await expect(dialog.getByTestId("practice-compare-method-link")).toHaveAttribute(
    "href",
    /METHOD\.md#123-the-profiles-compared$/,
  );
  // A row explains itself inside the dialog, a threshold by its reason.
  await dialog
    .getByRole("button", { name: "About Check-in frequency", exact: true })
    .click();
  const rowHint = page.getByTestId("method-hint-popup");
  await expect(rowHint).toContainText("a week is short enough");
  await expect(rowHint.getByRole("link")).toHaveAttribute(
    "href",
    /METHOD\.md#71-the-three-rituals$/,
  );
  await page.keyboard.press("Escape");
  await expect(rowHint).toBeHidden();
  await expect(dialog).toBeVisible();
  // The screen-wide scan never opens a dialog, so this one is scanned open.
  const scan = await new AxeBuilder({ page })
    .include('[data-testid="practice-compare"]')
    .analyze();
  expect(
    scan.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);

  // Escape closes it, and focus goes back to the button that opened it.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
});

test("every setting and profile says what it decides, by hover, tap or keyboard", async () => {
  await goTo(page, "/admin/practice");
  const hint = page.getByTestId("method-hint-popup");

  // A pointer resting on the "i" is enough.
  await page
    .getByRole("button", { name: "About Phase enforcement", exact: true })
    .hover();
  await expect(hint).toContainText("hold drafting back", { timeout: 15_000 });
  await expect(hint.getByRole("link")).toHaveAttribute(
    "href",
    /\/blob\/v[^/]+\/docs\/specification\/METHOD\.md#23-phase-completion-rules$/,
  );
  const scan = await new AxeBuilder({ page })
    .include('[data-testid="method-hint-popup"]')
    .analyze();
  expect(
    scan.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(hint).toBeHidden();

  // The keyboard reaches the same words, and Escape gives focus back.
  const reviewer = page.getByRole("button", {
    name: "About Reviewer per goal",
    exact: true,
  });
  await reviewer.focus();
  await page.keyboard.press("Enter");
  await expect(hint).toContainText("acknowledges its check-ins");
  await page.keyboard.press("Escape");
  await expect(hint).toBeHidden();
  await expect(reviewer).toBeFocused();

  // A profile says what it sets, read from the comparison, without choosing it.
  await page
    .getByRole("button", { name: "About Governed", exact: true })
    .click();
  await expect(hint).toContainText("Phase enforcement: Binding");
  await expect(hint.getByRole("link")).toHaveAttribute(
    "href",
    /METHOD\.md#122-profiles$/,
  );
  await expect(
    page.getByRole("radio", { name: /^Recommended/ }),
  ).toBeChecked();
  await page.keyboard.press("Escape");
});
