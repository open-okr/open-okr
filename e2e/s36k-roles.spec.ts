/**
 * Roles and permissions, the screen the matrix is read and changed on —
 * P8-G13b.
 *
 * Acceptance criteria:
 *   Given an administrator on the roles screen, when they change what a role
 *   may do in a domain, then it is saved and read back.
 *
 *   Given the Owner role, when the screen is drawn, then it offers no control
 *   and says why.
 *
 *   Given a role nobody holds, when an administrator adds and removes one,
 *   then both happen on the screen.
 *
 *   Given a role somebody holds, when an administrator removes it, then they
 *   are refused with the sentence the action gives.
 *
 * **What a browser proves here that the action tests cannot** is that the
 * matrix is reachable at all: P8-G13a shipped five actions with no screen,
 * and the whole point of this task is that an administrator can answer "who
 * may edit an objective" without the command line.
 *
 * **The acceptance criterion the plan writes for P8-G13b ends at the matrix,
 * not at a member going read-only.** A role raises a level and never lowers
 * one, so lowering Member on objectives does not take away the edit the
 * `space_standard` binding still grants. That binding is removed at P8-G13c,
 * and only then does the lowering bite. The design document says so in §8 and
 * this spec does not pretend otherwise.
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

const ADDED_ROLE = "Auditor";

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

test("sign in and open the roles screen", async () => {
  await signIn(page);
  await goTo(page, "/admin/roles");
  await expect(
    page.getByRole("heading", { name: "Roles and permissions" }),
  ).toBeVisible({ timeout: 15_000 });
});

test("the four built-in roles are there, and Owner is fixed", async () => {
  for (const name of ["Owner", "Admin", "Member", "Viewer"]) {
    await expect(page.getByRole("rowheader", { name: new RegExp(name) })).toBeVisible();
  }
  // Owner is drawn and offers nothing: hiding it would leave somebody
  // wondering where the most powerful role went.
  await expect(
    page.getByText("Owner cannot be changed", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "What Owner may do with Objectives" }),
  ).toHaveCount(0);
});

test("a cell is changed and read back", async () => {
  // **Written so a retry means the same thing as a first run.** The file runs
  // serial, so a later failure makes Playwright replay the whole of it; the
  // first version asserted the cell started at view, which is true once and
  // false on every replay, and that turned one defect into two reports.
  const named = { name: "What Viewer may do with Objectives" };
  const before = await page.getByRole("combobox", named).inputValue();
  const after = before === "40" ? "10" : "40";

  await page.getByRole("combobox", named).selectOption(after);

  await goTo(page, "/admin/roles");
  await expect(page.getByRole("combobox", named)).toHaveValue(after, {
    timeout: 15_000,
  });
});

/**
 * Arming and confirming a removal.
 *
 * The control is two steps: the first press swaps the row's button for a
 * confirm and a cancel, the second press commits. Both say "Delete", so
 * pressing twice in a row raced the re-render and sometimes landed both
 * presses on the pre-armed button, which is how this spec failed in
 * continuous integration having never been run here. Waiting for Cancel to
 * appear is what says the row is armed.
 */
async function removeRole(name: RegExp) {
  const row = page.getByRole("row", { name });
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(row.getByRole("button", { name: "Cancel" })).toBeVisible({
    timeout: 15_000,
  });
  await row.getByRole("button", { name: "Delete" }).click();
}

test("a role is added, held, refused removal, then removed", async () => {
  const added = new RegExp(ADDED_ROLE);

  await page.getByRole("button", { name: "Add role" }).click();
  const name = page.getByRole("textbox", { name: "Add role" });
  await name.fill(ADDED_ROLE);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("rowheader", { name: added })).toBeVisible({
    timeout: 15_000,
  });

  // Give it to somebody, and the removal is refused with the action's own
  // sentence rather than failing silently.
  const assign = page.getByRole("combobox", { name: /^Role for / }).first();
  await assign.selectOption({ label: ADDED_ROLE });
  await expect(assign).toHaveValue(/.+/);

  await removeRole(added);
  await expect(page.getByText("Somebody still holds this role")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("rowheader", { name: added })).toBeVisible();

  // Take it off them, and the removal goes through.
  await assign.selectOption({ label: "No role" });
  await removeRole(added);
  await expect(page.getByRole("rowheader", { name: added })).toHaveCount(0, {
    timeout: 15_000,
  });
});
