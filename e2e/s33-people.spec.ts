/**
 * The people directory and profile (screen S-33, P6-G09).
 *
 * Acceptance criterion:
 *   Given a workspace with a manager chain, when a member opens the directory,
 *   then every member they may see is listed and the chart draws the chain.
 *
 * The e2e instance has only one member (the founding admin), so this spec
 * proves the happy path: the directory lists that member, the profile page
 * renders with editable fields, and the org chart tab shows them as a root
 * node. Multi-member scenarios (suspended visibility, manager cycle
 * prevention) are tested in `packages/core/test/people.test.ts`.
 *
 * The lifecycle controls are P6-G10, and the single-member instance is the
 * right fixture for them rather than a limitation. The last-owner invariant
 * can only ever refuse on your own profile: the caller holds full access to
 * reach the card at all, so any other target already leaves a second
 * full-access holder behind. One member and one owner is that case exactly.
 */
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import pg from "pg";
import { INSTANCE_ACCOUNT, goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
/** Only the feed's live insert needs one, and only to write its seed row. */
let pool: pg.Pool;

const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      // The superuser, for the reason every other spec here records: these
      // setup queries have to find the workspace before they could set
      // `app.workspace_id`, and the forced row-level security policy would
      // otherwise answer with nothing rather than raising.
      testDbEnv.superuser,
    );

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await pool?.end();
  await context?.close();
});

test("sign in and reach the directory from the work map", async () => {
  await signIn(page);
  // The work map has a "Who is here" link.
  await expect(page.getByRole("link", { name: "Who is here" })).toBeVisible();
  await page.getByRole("link", { name: "Who is here" }).click();
  await page.waitForURL("/people");
  await expect(page).toHaveURL("/people");
});

test("the directory lists the signed-in member", async () => {
  await goTo(page, "/people");
  // The sidebar names "Ada Lovelace's workspace" in two places, so
  // getByText is ambiguous. The directory entry is a link whose href starts
  // with /people/ and whose text contains the member name.
  const directoryLink = page.locator("a[href^='/people/']", {
    hasText: INSTANCE_ACCOUNT.name,
  });
  await expect(directoryLink).toBeVisible();
});

test("search filters the member list", async () => {
  await goTo(page, "/people");
  const searchInput = page.getByPlaceholder("Search by name or title");
  await expect(searchInput).toBeVisible();
  // Search for a name that does not exist.
  await searchInput.fill("zzz-no-match");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No members match")).toBeVisible();
  // Clear and find the real member.
  await searchInput.fill(INSTANCE_ACCOUNT.name.split(" ")[0]);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(
    page.locator("a[href^='/people/']", {
      hasText: INSTANCE_ACCOUNT.name,
    }),
  ).toBeVisible();
});

test("the org chart tab renders at least one node", async () => {
  await goTo(page, "/people?view=chart");
  // The signed-in member has no manager, so they appear as a root node.
  // Scoped to links inside the chart (href starts with /people/).
  await expect(
    page.locator("a[href^='/people/']", {
      hasText: INSTANCE_ACCOUNT.name,
    }),
  ).toBeVisible();
});

test("the profile page loads for the signed-in member", async () => {
  await goTo(page, "/people");
  await page.getByRole("link", { name: INSTANCE_ACCOUNT.name }).first().click();
  await page.waitForURL(/\/people\//);
  // The profile shows the member's name and has a self-edit section.
  await expect(
    page.getByRole("heading", { name: INSTANCE_ACCOUNT.name }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Edit your profile" }),
  ).toBeVisible();
});

test("the profile has a timezone field", async () => {
  // Already on the profile page from the previous test.
  const timezone = page.locator("input[name='timezone']");
  await expect(timezone).toBeVisible();
});

test("the lifecycle card is on the admin's own profile", async () => {
  await goTo(page, "/people");
  await page.getByRole("link", { name: INSTANCE_ACCOUNT.name }).first().click();
  await page.waitForURL(/\/people\//);
  await expect(page.getByRole("heading", { name: "Lifecycle" })).toBeVisible();
  // The copy changes on your own profile, because everything here applies to
  // you rather than to somebody who is leaving.
  await expect(page.getByText("This is your own profile")).toBeVisible();
});

test("suspending the only owner is refused by name", async () => {
  // The confirm is accepted, because what is under test is the refusal that
  // comes after it rather than the dialog.
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await page.getByRole("button", { name: "Suspend" }).click();

  await expect(
    page.getByText(
      "This is the only member with full access to the workspace.",
    ),
  ).toBeVisible({ timeout: 15_000 });

  // Refused means nothing happened: no suspended chip, and the page still
  // belongs to a signed-in member.
  await expect(page.getByText("Suspended", { exact: true })).toHaveCount(0);
});

test("erasure asks for the name typed, and a wrong one erases nothing", async () => {
  await page.getByRole("button", { name: "Erase this member" }).click();
  await page.getByLabel(`Type ${INSTANCE_ACCOUNT.name} to confirm`).fill("not the name");
  await page
    .getByRole("button", { name: "Erase this member", exact: true })
    .click();

  await expect(
    page.getByText(`Type ${INSTANCE_ACCOUNT.name} exactly to confirm`),
  ).toBeVisible({ timeout: 15_000 });

  // Typed correctly, the domain refuses instead, for the same reason as the
  // suspension: there is nobody else who could administer the workspace.
  await page
    .getByLabel(`Type ${INSTANCE_ACCOUNT.name} to confirm`)
    .fill(INSTANCE_ACCOUNT.name);
  await page
    .getByRole("button", { name: "Erase this member", exact: true })
    .click();

  await expect(
    page.getByText(
      "This is the only member with full access to the workspace.",
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("erasure-export")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: INSTANCE_ACCOUNT.name }),
  ).toBeVisible();
});

/**
 * The watch control (S-03, P6-G07b).
 *
 * `subscriptions.toggle` shipped at P2-T06 and no page ever called it, because
 * nothing could answer "am I watching this" and a control that guessed its own
 * state is worse than none. `subscriptions.read` is the other half.
 *
 * The goal page is the one exercised here. The control is the same component
 * on all six subjects and a unit test holds that; what a browser adds is that
 * pressing it changes what the page says on the next load, which is the part
 * a source-reading test cannot see.
 */
test("watching a goal from its own page sticks", async () => {
  await goTo(page, "/goals");
  // The first `/goals/` link on this page is `/goals/studio`, the alignment
  // studio, which is a tool and not a goal. The href is read for one that is
  // actually an id rather than clicking whatever comes first.
  const goalUrl = await page
    .locator("a[href^='/goals/']")
    .evaluateAll((links) => {
      const match = links
        .map((link) => link.getAttribute("href") ?? "")
        .find((href) => /^\/goals\/[0-9a-f-]{36}$/.test(href));
      return match ?? "";
    });
  expect(goalUrl, "no goal link on /goals").not.toBe("");
  await goTo(page, goalUrl);

  const watch = page.getByTestId("watch-control");
  await expect(watch).toBeVisible();
  await expect(watch).toHaveText("Watch this");

  await watch.click();
  await expect(watch).toHaveText("Watching", { timeout: 15_000 });

  // Reloaded, because the point is that it was written and not just toggled
  // in the browser's own memory.
  await goTo(page, goalUrl);
  await expect(page.getByTestId("watch-control")).toHaveText("Watching");

  // And off again, so the instance is left as it was found for every spec
  // after this one.
  await page.getByTestId("watch-control").click();
  await expect(page.getByTestId("watch-control")).toHaveText("Watch this", {
    timeout: 15_000,
  });
});

/**
 * The feed at the other three scopes (S-31, P6-G11b).
 *
 * P6-G11a built the workspace feed at `/activity`. `queryFeed` could already
 * answer the space, goal and profile scopes and no read action reached them,
 * so nothing could show one. What a browser adds here is that each panel is on
 * the thing it is about and pages on its own url.
 */
test("a goal, a space and a profile each carry their own feed", async () => {
  // The goal.
  await goTo(page, "/goals");
  const goalHref = await page
    .locator("a[href^='/goals/']")
    .evaluateAll((links) => {
      const match = links
        .map((link) => link.getAttribute("href") ?? "")
        .find((href) => /^\/goals\/[0-9a-f-]{36}$/.test(href));
      return match ?? "";
    });
  expect(goalHref, "no goal link on /goals").not.toBe("");
  await goTo(page, goalHref);
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(
    page.getByText("its key results and its check-ins"),
  ).toBeVisible();

  // The space.
  await goTo(page, "/spaces");
  await page.locator("a[href^='/spaces/']").first().click();
  await page.waitForURL(/\/spaces\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(
    page.getByText("its goals, initiatives and tasks"),
  ).toBeVisible();

  // The profile, which is about the actor and says so.
  await goTo(page, "/people");
  await page.getByRole("link", { name: INSTANCE_ACCOUNT.name }).first().click();
  await page.waitForURL(/\/people\//);
  await expect(
    page.getByRole("heading", { name: "What they did" }),
  ).toBeVisible();
  await expect(page.getByText("Not what was done to them")).toBeVisible();
});

/**
 * Theme and density, kept on the member (S-33, P6-G23).
 *
 * `setTheme` and `setDensity` have existed on the provider since P2-T10 and
 * nothing ever called them, so both lived in `localStorage` only: a property
 * of a browser rather than of a person.
 *
 * The second context is the point of the task, not a flourish. A preference
 * that survived only a reload would be the behaviour this replaces.
 */
test("a theme follows the member to another browser", async ({ browser }) => {
  await goTo(page, "/people");
  await page.getByRole("link", { name: INSTANCE_ACCOUNT.name }).first().click();
  await page.waitForURL(/\/people\//);

  await expect(
    page.getByRole("heading", { name: "Appearance" }),
  ).toBeVisible();
  await page.getByTestId("theme-dark").first().click();
  await expect(page.getByTestId("theme-dark").first()).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  // A second context with the same session and its own empty storage, which
  // is what "another machine" means here.
  const second = await browser.newContext({
    storageState: await context.storageState(),
  });
  const secondPage = await second.newPage();
  await secondPage.goto("/");
  await expect(secondPage.locator("html")).toHaveAttribute(
    "data-theme",
    "dark",
    { timeout: 15_000 },
  );
  await second.close();

  // Back to following the system, so every spec after this one meets the
  // instance it expects.
  await goTo(page, "/people");
  await page.getByRole("link", { name: INSTANCE_ACCOUNT.name }).first().click();
  await page.waitForURL(/\/people\//);
  await page.getByTestId("theme-system").first().click();
  await expect(page.getByTestId("theme-system").first()).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

/**
 * The feed's live insert (S-31, P6-G11c).
 *
 * `workspaceFeedChannel` shipped at P2-T07 and nothing ever published on it,
 * so no feed anywhere moved without a navigation.
 *
 * The whole chain runs here: an outbox row is drained by the relay inside this
 * same server process, published on the workspace's feed channel, read by
 * `/api/feed/live`, forwarded as a bare ping, and answered by a refresh. The
 * page is never navigated after it is opened, which is what "without a reload"
 * means.
 *
 * **The row is written to be unmistakable, and the assertion is its text
 * rather than a count.** The first draft counted list items and failed at
 * 49 of an expected 50: the feed pages at fifty, so on an instance with more
 * activity than that a new row displaces the oldest instead of lengthening
 * the list. `workspace.renamed` renders its payload, so this row carries a
 * phrase nothing else in the workspace can produce.
 *
 * Its context is null, which `queryFeed` treats as visible to everybody, and
 * its actor is null. The actor matters: the route drops a ping for the
 * reader's own write, and a system row is nobody's.
 */
test("the workspace feed inserts a row without a reload", async () => {
  const MARKER = "P6-G11c live insert";

  const member = (
    await pool.query<{ id: string; workspace_id: string }>(
      `select m.id, m.workspace_id
         from workspace_members m
         join users u on u.id = m.user_id
        where u.email = $1 and m.deleted_at is null
        limit 1`,
      [INSTANCE_ACCOUNT.email],
    )
  ).rows[0];
  if (!member) {
    throw new Error(`Member not found for ${INSTANCE_ACCOUNT.email}`);
  }

  await goTo(page, "/activity");
  await expect(page.locator("main ul > li").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(MARKER)).toHaveCount(0);

  const inserted = (
    await pool.query<{ id: string }>(
      `insert into activities
         (id, workspace_id, kind, payload, actor_member_id, actor_kind,
          subject_type, subject_id, space_id, context_id, at)
       values (gen_random_uuid(), $1, 'workspace.renamed', $2::jsonb, null,
               'system', 'workspace', $1, null, null, now())
       returning id`,
      [member.workspace_id, JSON.stringify({ from: "Before", to: MARKER })],
    )
  ).rows[0];
  if (!inserted) {
    throw new Error("insert into activities returned no row");
  }

  await pool.query(
    `insert into outbox (topic, payload, idempotency_key, available_at)
     values ('feed.added', $1::jsonb, $2, now())`,
    [
      JSON.stringify({
        channel: `workspace:${member.workspace_id}:feed`,
        workspaceId: member.workspace_id,
        activityId: inserted.id,
        actorMemberId: null,
      }),
      `feed.added:${inserted.id}`,
    ],
  );

  // The client collapses a burst into one refresh on a 1.5 second trailing
  // window, so the row lands a moment after the ping rather than with it.
  await expect(page.getByText(MARKER)).toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).pathname).toBe("/activity");
});

/**
 * The locale is the member's, not `en` (UIUX-PLAN §8, P6-G22a).
 *
 * The catalogue shipped at P2-T10 and the root layout pinned `en` for eight
 * phases, so `TranslationsProvider` took a locale nothing could select. What
 * is proved here is the round trip through the browser: choosing a language
 * changes what the document says it is, and clearing it puts the member back
 * on the workspace's.
 *
 * `html lang` is the assertion rather than a translated string, and
 * deliberately: most screens are still English because their strings are not
 * in the catalogue yet, which is P6-G22c. What changed at this row is that the
 * choice reaches the renderer at all.
 */
test("a member's language reaches the document", async () => {
  await goTo(page, "/people");
  await page.getByRole("link", { name: INSTANCE_ACCOUNT.name }).first().click();
  await page.waitForURL(/\/people\//);

  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page.getByTestId("language-ms").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ms", {
    timeout: 15_000,
  });

  // It survives a navigation, which is what "stored on the member" means: the
  // theme is applied by a provider in this browser, and this is not.
  await goTo(page, "/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ms");

  // And back, so the instance is as it was for whatever spec runs next.
  await goTo(page, "/people");
  await page.getByRole("link", { name: INSTANCE_ACCOUNT.name }).first().click();
  await page.waitForURL(/\/people\//);
  await page.getByTestId("language-en").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en", {
    timeout: 15_000,
  });
});

/**
 * The detail-page writes that had no browser caller (P6-G27, GAP-AUDIT §5).
 *
 * The acceptance criterion, end to end: given a member with edit access on a
 * goal, when they move it to another cycle, then the move is audited and both
 * cycles read correctly.
 *
 * `goals.moveToCycle`, `goals.unlinkKpi`, `goals.delete`, `tasks.delete`,
 * `initiatives.delete`, `documents.delete`, `tasks.removeChecklistItem` and
 * `reactions.remove` all shipped with their entities and none could be reached
 * from a screen.
 *
 * **Only one cycle exists on this instance, so the move is proved by what the
 * control offers rather than by performing it.** Creating a second cycle here
 * would move the goal every later spec reads, and `cycles.create` is P6-G27b's
 * own row. The write itself is proved against a real database in
 * `packages/core`.
 */
test("a goal carries the writes that had no browser path", async () => {
  await goTo(page, "/goals");
  const goalHref = await page
    .locator("a[href^='/goals/']")
    .evaluateAll((links) => {
      const match = links
        .map((link) => link.getAttribute("href") ?? "")
        .find((href) => /^\/goals\/[0-9a-f-]{36}$/.test(href));
      return match ?? "";
    });
  expect(goalHref, "no goal link on /goals").not.toBe("");
  await goTo(page, goalHref);

  // The cycle picker, offering the cycle the goal is already in. Disabled,
  // because moving a goal to the cycle it is in is not a move.
  const target = page.getByLabel("Cycle to move this goal to");
  await expect(target).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("move-to-cycle")).toBeDisabled();

  // The delete, which arms before it acts and says what a delete is here.
  await page.getByTestId("delete-goal-arm").click();
  await expect(page.getByTestId("delete-goal")).toContainText(
    "Nothing is destroyed",
  );
  // And is stepped back from, because this goal is what six later specs read.
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(page.getByTestId("delete-goal-arm")).toBeVisible();
});
