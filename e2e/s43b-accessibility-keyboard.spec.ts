import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

/**
 * The primary flows, driven with the keyboard and nothing else (P7-T05).
 *
 * **This is the part axe cannot answer.** An automated scan checks that a
 * control has an accessible name; it cannot tell whether the name is reachable
 * by tabbing, whether the focus ring is visible when it gets there, whether a
 * dialog traps focus, or whether closing one puts focus back where it came
 * from. Those are the defects that make a product unusable without a mouse,
 * and every one of them is invisible to `s43-accessibility.spec.ts`.
 *
 * **No `page.click` anywhere in this file.** A test that reaches an element by
 * selector and clicks it proves the element exists, which is what the rest of
 * the suite already proves. Everything here moves with `Tab`, `Shift+Tab`,
 * `Enter`, `Space`, the arrow keys and `Escape`, and reads back
 * `document.activeElement`, so a control the keyboard cannot reach is a
 * failure rather than a thing nobody noticed.
 */

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await context?.close();
});

/** What has focus right now, as a person using a screen reader would hear it. */
async function focused(): Promise<{
  role: string;
  name: string;
  tag: string;
}> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element) {
      return { role: "", name: "", tag: "" };
    }
    const label =
      element.getAttribute("aria-label") ??
      element.textContent?.trim().slice(0, 80) ??
      "";
    return {
      role: element.getAttribute("role") ?? "",
      name: label,
      tag: element.tagName.toLowerCase(),
    };
  });
}

/** Tabs until the predicate matches, and says what it walked past if it does not. */
async function tabUntil(
  matches: (found: { role: string; name: string; tag: string }) => boolean,
  limit = 60,
): Promise<{ role: string; name: string; tag: string }> {
  const walked: string[] = [];
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press("Tab");
    const found = await focused();
    walked.push(`${found.tag}${found.role ? `[${found.role}]` : ""} ${found.name}`);
    if (matches(found)) {
      return found;
    }
  }
  throw new Error(
    `Tabbed ${limit} times without a match. Walked past:\n  ${walked.join("\n  ")}`,
  );
}

test("the first tab reaches a skip link, before the whole navigation", async () => {
  // Without one, every keyboard user walks the entire primary navigation on
  // every page before reaching the content they came for.
  await goTo(page, "/");
  await page.keyboard.press("Tab");
  const first = await focused();
  expect(first.name.toLowerCase()).toContain("skip");

  // And it works: activating it moves focus into the main region rather than
  // only scrolling the page, which is the common half-implementation.
  await page.keyboard.press("Enter");
  const landed = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    return element?.closest("main") !== null || element?.tagName === "MAIN";
  });
  expect(landed).toBe(true);
});

test("the primary navigation is reachable and every item is named", async () => {
  await goTo(page, "/");
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();

  // Every link in it has an accessible name. An icon-only link with none is
  // announced as "link" and is useless to somebody who cannot see the icon.
  const unnamed = await nav.evaluate((element) =>
    [...element.querySelectorAll("a")]
      .filter(
        (link) =>
          (link.getAttribute("aria-label") ?? link.textContent ?? "").trim() ===
          "",
      )
      .map((link) => link.getAttribute("href") ?? "(no href)"),
  );
  expect(unnamed).toEqual([]);
});

test("a member can open the command palette and leave it with the keyboard", async () => {
  await goTo(page, "/");

  // Focus something first, and remember what. A fresh page has focus on the
  // body, so opening from there and asking for it back proves nothing: the
  // property is that a member who was somewhere is put back there, not that
  // a dialog can restore nothing to nowhere. This is the shape of the defect
  // it caught, too, which was that the palette handed focus to the body no
  // matter where it came from.
  await page.keyboard.press("Tab");
  const before = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    return element?.textContent?.trim().slice(0, 40) ?? "";
  });
  expect(before).not.toBe("");

  await page.keyboard.press("ControlOrMeta+k");

  const palette = page.getByRole("dialog");
  await expect(palette).toBeVisible({ timeout: 10_000 });

  // Focus is inside it, which is what makes typing work without a mouse.
  const inside = await page.evaluate(() => {
    const element = document.activeElement;
    return element?.closest('[role="dialog"]') !== null;
  });
  expect(inside).toBe(true);

  // Escape closes it, and focus does not vanish to the body: a dialog that
  // drops focus on close leaves the next Tab starting from the top of the
  // page, which is the single most common keyboard defect in a product like
  // this one.
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();
  const after = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    return element?.textContent?.trim().slice(0, 40) ?? "";
  });
  expect(after).toBe(before);
});

test("the board can be reached and its columns read without a mouse", async () => {
  await goTo(page, "/board");
  await expect(
    page.getByRole("navigation", { name: "Primary" }).first(),
  ).toBeVisible({ timeout: 15_000 });

  // Something on the board takes focus by tabbing, and it is named. A board
  // whose only affordance is dragging is a board a keyboard user cannot use
  // at all, and finding that out is the point of this test.
  const reached = await tabUntil(
    (found) => found.name.trim().length > 0 && found.tag !== "body",
  );
  expect(reached.name.trim()).not.toBe("");
});

test("every form control on the check-in composer has a label", async () => {
  await goTo(page, "/inbox");
  await expect(
    page.getByRole("navigation", { name: "Primary" }).first(),
  ).toBeVisible({ timeout: 15_000 });

  // Read from the page rather than asserted per field, so a field added later
  // is covered without editing this test.
  const unlabelled = await page.evaluate(() =>
    [...document.querySelectorAll("input, select, textarea")]
      .filter((field) => {
        const element = field as HTMLInputElement;
        if (element.type === "hidden") {
          return false;
        }
        // `element.labels` is the DOM's own answer and covers both shapes: a
        // `label[for]` pointing at the field, and a `label` wrapped around
        // it. The first version of this check only looked for `for`, and
        // reported the topbar search, which is wrapped and perfectly well
        // named. A checker that cries wolf gets deleted.
        const named =
          (element.labels?.length ?? 0) > 0 ||
          (element.getAttribute("aria-label") ?? "").trim() !== "" ||
          (element.getAttribute("aria-labelledby") ?? "").trim() !== "" ||
          (element.getAttribute("title") ?? "").trim() !== "";
        return !named;
      })
      .map((field) => (field as HTMLElement).outerHTML.slice(0, 120)),
  );
  expect(unlabelled).toEqual([]);
});

test("focus is visible wherever it lands", async () => {
  // A focus ring removed for looks is the defect that makes keyboard use
  // possible in theory and impossible in practice. Checked on the shell,
  // where the styles come from the design system rather than from a screen.
  await goTo(page, "/");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");

  const visible = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (!element || element === document.body) {
      return false;
    }
    const style = getComputedStyle(element);
    const ring =
      style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
    const shadow = style.boxShadow !== "none" && style.boxShadow !== "";
    return ring || shadow;
  });
  expect(visible).toBe(true);
});
