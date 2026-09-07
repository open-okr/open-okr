/**
 * The copilot panel — P4-T14a-b (screen S-39, AI-NATIVE-PLAN.md §2.4).
 *
 * Acceptance criterion:
 *   Given a member stopping an answer halfway, when they reopen the thread,
 *   then what had arrived is there, marked as stopped, and the conversation
 *   can continue.
 *
 * **The stop control is not what this file can prove, and saying so is the
 * point.** This instance has no AI provider, so there is no stream to stop:
 * `streamGrounded` is absent, the panel never shows a stop control, and there
 * is nothing to interrupt. The stop path is proved in
 * `packages/core/test/copilot-stream.test.ts`, both ways a reader can stop one,
 * against a scripted provider. What this file proves is the state every
 * self-hosted instance without a key actually runs in, which is the one a
 * browser can reach here: the panel opens, says why it cannot write prose, still
 * records the question, and the conversation reads back.
 *
 * **The file name carries the run order, and has to.** Specs run alphabetically
 * against one instance, and `registration-to-dashboard.spec.ts` is the spec that
 * claims it: its first test is the registration path, so anything that registers
 * before it turns that test red. This file was `copilot.spec.ts` for one run and
 * did exactly that. `s39` is screen S-39, and it sorts after `registration-`.
 *
 * There is a second reason a live answer is out of reach in a browser today, and
 * it is worth writing down rather than discovering later: **nothing consumes the
 * `content.embed` outbox topic in a running instance.** No relay host exists yet
 * (nothing constructs `OutboxRelay` anywhere), so no goal is indexed, so
 * retrieval finds nothing to cite even with a key configured. That is a gap in
 * the product, not in this spec.
 */
import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

const QUESTION = "How is mid-market activation going this quarter?";

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close();
});

test("sign in and land on the Work Map", async () => {
  await signIn(page);

  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 10_000 });
});

test("the topbar offers the copilot with its shortcut", async () => {
  const ask = page.getByRole("button", { name: "Ask the copilot" });
  await expect(ask).toBeVisible();
  // The slot in `Topbar` was deliberately left empty until S-39 existed. This
  // is the assertion that it no longer is.
  //
  // "Command J" and not "⌘J": the modifier is a Lucide icon now, because U+2318
  // is absent from the self-hosted Geist subset and the browser was drawing it
  // from a system symbol font at 11.4px of advance against the letter's 6.9px,
  // differently on every operating system. The hidden label is what a screen
  // reader announces, so it is the right thing to assert, and the icon is
  // checked separately so a silent return to a font glyph fails here.
  await expect(ask).toContainText("Command J");
  await expect(ask.locator("kbd svg")).toBeVisible();
});

test("⌘J opens the panel, and it says the copilot cannot write prose", async () => {
  await page.keyboard.press("ControlOrMeta+j");

  const panel = page.getByRole("dialog", { name: "Copilot" });
  await expect(panel).toBeVisible();
  // The AI-off state, which is a working panel and not an error.
  await expect(panel.getByText("AI off")).toBeVisible();
  await expect(
    panel.getByText("Ask about this workspace's goals", { exact: false }),
  ).toBeVisible();
  // The box still invites a question, and its placeholder says what asking will
  // actually do here: search, not answer.
  await expect(panel.getByPlaceholder("Search your workspace")).toBeVisible();
});

/**
 * **The panel has to escape the topbar, and a height is how a browser can say
 * so.** `CopilotPanel` renders both the trigger and the panel, and the trigger
 * lives in `Topbar`, which carries `backdrop-blur-md`. A backdrop filter makes
 * an element the containing block for every `position: fixed` descendant, so
 * `inset-y-0` on the panel resolved against the 50px topbar rather than the
 * viewport: a 49px strip with its content spilling out over the page and
 * nothing painted behind it. Every class on the panel was correct, which is why
 * this assertion is a measurement rather than a class name.
 */
test("the panel fills the viewport rather than the topbar", async () => {
  const panel = page.getByRole("dialog", { name: "Copilot" });
  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) {
    throw new Error("The panel or the viewport has no box to measure.");
  }
  expect(box.y).toBeLessThanOrEqual(1);
  expect(box.height).toBeGreaterThan(viewport.height * 0.9);
});

test("⌘J closes it again", async () => {
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.getByRole("dialog", { name: "Copilot" })).toBeHidden();
});

test("a question is recorded and answered with what is there to find", async () => {
  await page.keyboard.press("ControlOrMeta+j");
  const panel = page.getByRole("dialog", { name: "Copilot" });
  await expect(panel).toBeVisible();

  await panel.getByPlaceholder("Search your workspace").fill(QUESTION);
  await panel.getByRole("button", { name: "Send the question" }).click();

  // The question is a turn in the thread, straight away and then again from the
  // server once the request lands.
  await expect(panel.getByText(QUESTION)).toBeVisible({ timeout: 15_000 });
  // And the panel explains itself rather than sitting silent: no provider, so
  // no prose, and it says which. `first` because the footer says the same thing
  // about the workspace's state while this says it about this turn.
  await expect(
    panel.getByText("No AI provider is configured", { exact: false }).first(),
  ).toBeVisible({ timeout: 15_000 });
});

test("the conversation is there when the panel is reopened", async () => {
  // Closed and reopened rather than reloaded, because that is the path a reader
  // takes: the panel re-reads its threads on every open.
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.getByRole("dialog", { name: "Copilot" })).toBeHidden();

  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 10_000 });
  // **Network idle, not just the heading.** The heading is server-rendered and
  // visible before the bundle has run, and the shortcut is registered in an
  // effect, so pressing as soon as the heading appears can press into a page
  // with no handler. That is what "element(s) not found" on the dialog meant on
  // CI.
  await page.waitForLoadState("networkidle");

  await page.keyboard.press("ControlOrMeta+j");
  const panel = page.getByRole("dialog", { name: "Copilot" });
  await expect(panel).toBeVisible();

  // The thread's title is the question, shortened. A fresh panel opens empty
  // with the earlier conversations listed, which is where it is.
  await expect(panel.getByText("Earlier conversations")).toBeVisible({
    timeout: 15_000,
  });
  const earlier = panel.getByRole("button", {
    name: QUESTION.slice(0, 40),
    exact: false,
  });
  await expect(earlier.first()).toBeVisible();

  await earlier.first().click();
  // **Wait for the list to go before looking for the question.** Loading a
  // thread replaces "Earlier conversations" with the conversation itself, so
  // until it is gone the only thing on the panel carrying this text is the list
  // entry that was just clicked. Asserting before then passed whether or not
  // the click did anything, and it failed on CI as a strict-mode violation the
  // moment a retry created a second thread with the same title. The turn is
  // what this test is about.
  await expect(panel.getByText("Earlier conversations")).toBeHidden({
    timeout: 15_000,
  });
  await expect(panel.getByText(QUESTION)).toBeVisible({ timeout: 15_000 });
});

/**
 * **A bug found here and deliberately not fixed here.** The next assertion was
 * going to be that the `?` overlay lists the copilot, because a shortcut nobody
 * can discover is half a feature. It cannot be written: `ShortcutOverlay`
 * registers `{ key: "?" }` with no `shift`, and `useKeyboardShortcut` reads a
 * missing `shift` as "shift must not be held". On a keyboard where `?` is a
 * shifted key, which is most of them, the overlay's own shortcut can never fire.
 *
 * That belongs to P2-T10's component and not to this task, so it is recorded on
 * the P4-T14a-b row rather than changed under cover of a copilot task. The
 * copilot's own registration is asserted the only other way available: the
 * shortcut itself works, which the tests above prove.
 */
test("⌘J still works after a reload, so the shortcut is really registered", async () => {
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.getByRole("dialog", { name: "Copilot" })).toBeHidden();

  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 10_000 });
  // **Network idle, not just the heading.** The heading is server-rendered and
  // visible before the bundle has run, and the shortcut is registered in an
  // effect, so pressing as soon as the heading appears can press into a page
  // with no handler. That is what "element(s) not found" on the dialog meant on
  // CI.
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.getByRole("dialog", { name: "Copilot" })).toBeVisible();
});
