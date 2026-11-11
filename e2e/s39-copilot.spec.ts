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
import { expect, test } from "./fixtures.ts";
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
  // The hint sits beside the button, not inside it: every visible word inside
  // a button has to be part of its name (WCAG 2.5.3), so "⌘J" inside "Ask the
  // copilot" failed axe's label-in-name check. The button announces the
  // shortcut itself.
  await expect(ask).toHaveAttribute("aria-keyshortcuts", "Control+J Meta+J");
  //
  // "Command J" and not "⌘J": the modifier is a Lucide icon now, because U+2318
  // is absent from the self-hosted Geist subset and the browser was drawing it
  // from a system symbol font at 11.4px of advance against the letter's 6.9px,
  // differently on every operating system. The hidden label is what a screen
  // reader announces, so it is the right thing to assert, and the icon is
  // checked separately so a silent return to a font glyph fails here.
  const hint = ask.locator("xpath=following-sibling::kbd[1]");
  await expect(hint).toContainText("Command J");
  await expect(hint.locator("svg")).toBeVisible();
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
  // S-39's "AI off with a link for admins" (plan 0.8.1 CP8). The instance's
  // owner can open the AI page, so it is linked.
  await expect(
    panel.getByRole("link", { name: "Open AI settings" }),
  ).toHaveAttribute("href", "/admin/ai");
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

/**
 * **Frame and keyboard** (plan 0.8.1 CP1, review F4 and F16).
 *
 * Acceptance criteria:
 *   Given the panel open and focus in the composer with nothing typed, when
 *   the person presses Escape, then the panel closes and focus is on "Ask the
 *   copilot".
 *   Given the panel open, when the person presses the close button, then
 *   focus is on "Ask the copilot".
 */
test("Escape closes it, and focus goes back to Ask", async () => {
  const ask = page.getByRole("button", { name: "Ask the copilot" });
  await ask.click();
  const panel = page.getByRole("dialog", { name: "Copilot" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("textbox")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(ask).toBeFocused();
});

test("the close button gives focus back to Ask too", async () => {
  const ask = page.getByRole("button", { name: "Ask the copilot" });
  await ask.click();
  const panel = page.getByRole("dialog", { name: "Copilot" });
  await panel.getByRole("button", { name: "Close the copilot" }).click();
  await expect(panel).toBeHidden();
  await expect(ask).toBeFocused();
});

/**
 * Acceptance criteria:
 *   Given compact density at 1440, when the panel opens, then it is 512px
 *   wide, the same as comfortable.
 *   Given the panel open at 1440, when the person presses Expand, closes,
 *   reloads and opens it again, then it opens 768px wide.
 */
test("it is 512 pixels wide in either density, and Expand stays expanded", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const panel = page.getByRole("dialog", { name: "Copilot" });
  const width = async () => Math.round((await panel.boundingBox())?.width ?? 0);

  await page.getByRole("button", { name: "Ask the copilot" }).click();
  await expect(panel).toBeVisible();
  expect(await width()).toBe(512);

  // Compact density shrinks the spacing unit; the panel is on the container
  // scale, so it does not narrow with it.
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-density", "compact"),
  );
  expect(await width()).toBe(512);

  await panel.getByRole("button", { name: "Expand the copilot" }).click();
  await expect.poll(width).toBe(768);
  await panel.getByRole("button", { name: "Close the copilot" }).click();

  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Ask the copilot" }).click();
  await expect(panel).toBeVisible();
  await expect.poll(width).toBe(768);

  // Back to the default, so the measurements in the rest of this file are
  // of the panel as most people see it.
  await panel.getByRole("button", { name: "Expand the copilot" }).click();
  await expect.poll(width).toBe(512);
  await panel.getByRole("button", { name: "Close the copilot" }).click();
  await expect(panel).toBeHidden();
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

  // **And it stays once the turn has landed** (plan 0.8.1 CP8, review F1).
  // The re-read after a turn used to take the reason and the passages off the
  // screen, and the assertion above passed on the footer's sentence. This is
  // the answer's own sentence, which the footer never says.
  await expect(panel.getByRole("textbox")).toBeEnabled({ timeout: 30_000 });
  await expect(
    panel
      .getByRole("log", { name: "Conversation" })
      .getByText("these are the passages that match your question", {
        exact: false,
      }),
  ).toBeVisible();
  // And the composer has focus again for the next question (plan 0.8.1 CP1).
  await expect(panel.getByRole("textbox")).toBeFocused();
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

  // The thread's title is the question, shortened, and History is where the
  // member's conversations are listed (plan 0.8.1 CP2).
  await panel.getByRole("button", { name: "History" }).click();
  const history = panel.getByRole("navigation", { name: "History" });
  await expect(history).toBeVisible({ timeout: 15_000 });
  const earlier = history.getByRole("button", {
    name: QUESTION.slice(0, 40),
    exact: false,
  });
  await expect(earlier.first()).toBeVisible({ timeout: 15_000 });

  await earlier.first().click();
  // **Wait for the list to go before looking for the question.** Opening a
  // conversation replaces History with it, so until it is gone the only thing
  // on the panel carrying this text is the entry that was just clicked.
  // Asserting before then passed whether or not the click did anything, and it
  // failed on CI as a strict-mode violation the moment a retry created a
  // second thread with the same title. The turn is what this test is about.
  await expect(history).toBeHidden({ timeout: 15_000 });
  await expect(panel.getByText(QUESTION)).toBeVisible({ timeout: 15_000 });
});

/**
 * **The open conversation lives in the address** (plan 0.8.1 CP2).
 *
 * Acceptance criterion: given two earlier conversations, when the person opens
 * History and picks one, then its turns show, the address carries
 * `?copilot=<id>`, and reloading shows the same thread.
 */
test("the open conversation is in the address, and a reload comes back to it", async () => {
  await expect(page).toHaveURL(/[?&]copilot=[0-9a-f-]{36}/);
  await page.reload();
  const panel = page.getByRole("dialog", { name: "Copilot" });
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByText(QUESTION)).toBeVisible({ timeout: 15_000 });
});

/**
 * Acceptance criterion: given a thread open, when the person presses New
 * chat, then the thread is empty, the composer is focused, and the next
 * question starts a new thread.
 */
test("New chat starts an empty conversation", async () => {
  const panel = page.getByRole("dialog", { name: "Copilot" });
  await panel.getByRole("button", { name: "New chat" }).click();
  await expect(panel.getByText(QUESTION)).toBeHidden();
  await expect(panel.getByRole("textbox")).toBeFocused();
  await expect(page).not.toHaveURL(/[?&]copilot=/);
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
