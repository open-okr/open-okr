/**
 * Copilot proposals in the panel — P4-T14b-a (screen S-39).
 *
 * Acceptance criterion:
 *   Given a member asking the copilot to create a goal, when they approve the
 *   proposal, then the goal is created through the normal Operation with audit,
 *   an AI provenance chip and a working undo.
 *
 * **The proposal is inserted with SQL, and it has to be.** A proposal only exists
 * because a model wrote one, and this instance has no AI provider, so nothing a
 * browser can do here produces one. The same reason `sessions.spec.ts` creates
 * its session with `pg`: the path from a model to a proposal is covered in
 * `packages/core/test/copilot-proposals.test.ts` and
 * `packages/agents/test/copilot-drafter.test.ts` against scripted providers.
 * What only a browser can prove is the part after that, which is what a reader
 * sees and what the buttons do.
 *
 * **The file name carries the run order.** Specs run alphabetically against one
 * instance and `registration-to-dashboard.spec.ts` is the one that claims it, so
 * anything that signs in has to sort after `registration-`. `s39b` follows
 * `s39-copilot.spec.ts`.
 */
import { expect, test } from "./fixtures.ts";
import type { BrowserContext, Page } from "@playwright/test";
import { connectionOptions, testDbEnv } from "@openokr/test-support/db";
import pg from "pg";
import { INSTANCE_ACCOUNT, signIn } from "./instance-account.ts";

const CONNECTION = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : connectionOptions(
      process.env.E2E_DATABASE ?? "openokr_e2e",
      // The superuser, for the reason `sessions.spec.ts` records at length:
      // these setup queries have to find the workspace before they could set
      // `app.workspace_id`, and the application role sees nothing until it is.
      testDbEnv.superuser,
    );

const TITLE = "Cut mid-market onboarding to two days";

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let pool: pg.Pool;
let workspaceId: string;
let memberId: string;
let threadId: string;

test.beforeAll(async ({ browser }) => {
  pool = new pg.Pool(CONNECTION);
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await pool?.end();
  await context?.close();
});

/**
 * Opens the panel by clicking, not by pressing ⌘J.
 *
 * The shortcut is `s39-copilot.spec.ts`'s subject and is proved there. Here it
 * was a source of flake: a key press sent while a navigation is still settling
 * goes nowhere, and this file navigates between its tests. Waiting for the Work
 * Map heading and then clicking the button is the same door, held open.
 */
async function openPanel(): Promise<void> {
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 15_000 });
  const panel = page.getByRole("dialog", { name: "Copilot" });
  if (await panel.isVisible()) {
    return;
  }
  await page.getByRole("button", { name: "Ask the copilot" }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
}

/** Opens one of the member's conversations from History (plan 0.8.1 CP2). */
async function openConversation(title: string): Promise<void> {
  await openPanel();
  const panel = page.getByRole("dialog", { name: "Copilot" });
  const history = panel.getByRole("navigation", { name: "History" });
  if (!(await history.isVisible())) {
    await panel.getByRole("button", { name: "History" }).click();
  }
  await history.getByRole("button", { name: title, exact: true }).click();
  await expect(history).toBeHidden({ timeout: 15_000 });
}

test("sign in and land on the Work Map", async () => {
  await signIn(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Work map" }),
  ).toBeVisible({ timeout: 10_000 });
});

test("a proposal is waiting in a conversation", async () => {
  const member = (
    await pool.query<{ id: string; workspace_id: string }>(
      `select m.id, m.workspace_id
       from workspace_members m
       join users u on u.id = m.user_id
       where u.email = $1
       limit 1`,
      [INSTANCE_ACCOUNT.email],
    )
  ).rows[0];
  if (!member) {
    throw new Error("Member not found. Did the claiming spec run?");
  }
  memberId = member.id;
  workspaceId = member.workspace_id;

  const space = (
    await pool.query<{ id: string; name: string }>(
      "select id, name from spaces where workspace_id = $1 and deleted_at is null order by created_at limit 1",
      [workspaceId],
    )
  ).rows[0];
  if (!space) {
    throw new Error("No space to own the objective.");
  }
  const cycle = (
    await pool.query<{ id: string }>(
      "select id from cycles where workspace_id = $1 and deleted_at is null order by starts_on limit 1",
      [workspaceId],
    )
  ).rows[0];
  if (!cycle) {
    throw new Error("No cycle to put the objective in.");
  }

  const thread = (
    await pool.query<{ id: string }>(
      `insert into ai_threads (id, workspace_id, member_id, title)
       values (gen_random_uuid(), $1, $2, 'Onboarding objective')
       returning id`,
      [workspaceId, memberId],
    )
  ).rows[0];
  threadId = thread?.id as string;
  await pool.query(
    `insert into ai_messages (id, workspace_id, thread_id, role, content)
     values (gen_random_uuid(), $1, $2, 'member', 'Create an objective for onboarding')`,
    [workspaceId, threadId],
  );

  // The payload a `buildProposal` call would have produced: every identifier is
  // the product's, and the preview and the sentence travel beside it.
  await pool.query(
    `insert into proposed_changes
       (id, workspace_id, run_id, thread_id, action, payload, subject_type, subject_id, status, ai_generated)
     values (gen_random_uuid(), $1, null, $2, 'goals.create', $3::jsonb, 'space', $4, 'pending', true)`,
    [
      workspaceId,
      threadId,
      JSON.stringify({
        title: TITLE,
        cycleId: cycle.id,
        level: "team",
        ownerKind: "space",
        spaceId: space.id,
        championId: memberId,
        reviewerId: memberId,
        weight: 1,
        __preview: [
          { label: "Objective", value: TITLE },
          { label: "Level", value: "team" },
          { label: "Space", value: space.name },
        ],
        __why: "You asked for an onboarding objective and this cycle has none.",
      }),
      space.id,
    ],
  );
});

test("the panel shows it with its provenance, its preview and its reason", async () => {
  await openConversation("Onboarding objective");
  const panel = page.getByRole("dialog", { name: "Copilot" });

  const card = panel.getByRole("region", { name: "Proposed change" });
  await expect(card).toBeVisible({ timeout: 15_000 });
  // The provenance chip: a reviewer's first question is who wrote this.
  await expect(card.getByText("AI", { exact: true })).toBeVisible();
  // Named, not keyed: the card says what the change is rather than printing
  // the registry's name for it (completeness review M-09, P8-G11d's rule).
  await expect(card.getByText("New objective")).toBeVisible();
  await expect(card.getByText("goals.create")).toHaveCount(0);
  await expect(card.getByText(TITLE)).toBeVisible();
  await expect(
    card.getByText("You asked for an onboarding objective", { exact: false }),
  ).toBeVisible();
  await expect(card.getByRole("button", { name: "Apply" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Dismiss" })).toBeVisible();
  // Nothing is offered for undoing something that has not been applied.
  await expect(card.getByRole("button", { name: "Undo" })).toBeHidden();
});

test("applying it creates the objective through the normal Operation", async () => {
  const panel = page.getByRole("dialog", { name: "Copilot" });
  const card = panel.getByRole("region", { name: "Proposed change" });
  await card.getByRole("button", { name: "Apply" }).click();

  await expect(card.getByText("Applied")).toBeVisible({ timeout: 20_000 });
  // Now an undo is offered, because `goals.create` has a reverse.
  await expect(card.getByRole("button", { name: "Undo" })).toBeVisible();

  const goal = (
    await pool.query<{ id: string; title: string }>(
      "select id, title from goals where workspace_id = $1 and title = $2 and deleted_at is null",
      [workspaceId, TITLE],
    )
  ).rows[0];
  expect(goal?.title).toBe(TITLE);

  // And the card links to what it made (plan 0.8.1 CP7, review F28).
  await expect(
    card.getByRole("link", { name: "Open the objective" }),
  ).toHaveAttribute("href", `/goals/${goal?.id}`);

  // Through the pipeline means an audit row for the goal's own creation, not
  // only for the decision to apply it.
  const audit = await pool.query<{ action: string }>(
    "select action from audit_events where target_id = $1",
    [goal?.id],
  );
  expect(audit.rows.map((row) => row.action)).toContain("goals.create");

  // And it is really there, on the page the objective lives on.
  await page.goto(`/goals/${goal?.id}`);
  const heading = page.getByRole("heading", { name: TITLE, level: 1 });
  await expect(heading).toBeVisible({ timeout: 15_000 });

  // **The heading is wide, not merely present.** This assertion was
  // `getByText(TITLE).first()` and it failed in continuous integration
  // reading "hidden" on a heading the screenshot showed painted, which is
  // what Playwright reports for an element whose box is empty. The cause was
  // a third child in the two-column row above it, squeezing a `min-w-0`
  // content column towards zero. A named heading with a real width fails
  // pointing at the collapse rather than at a locator.
  const box = await heading.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(240);
});

test("undoing it removes the objective and says so", async () => {
  // The previous test navigated to the objective's own page, so the panel is
  // closed and the shell has just rendered again.
  await page.goto("/");
  await openConversation("Onboarding objective");
  const panel = page.getByRole("dialog", { name: "Copilot" });

  const card = panel.getByRole("region", { name: "Proposed change" });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole("button", { name: "Undo" }).click();

  await expect(card.getByText("Undone")).toBeVisible({ timeout: 20_000 });

  const live = await pool.query<{ count: string }>(
    "select count(*) from goals where workspace_id = $1 and title = $2 and deleted_at is null",
    [workspaceId, TITLE],
  );
  expect(live.rows[0]?.count).toBe("0");

  // Soft, not gone: the row is still there for every audit and activity row
  // that points at it.
  const removed = await pool.query<{ count: string }>(
    "select count(*) from goals where workspace_id = $1 and title = $2 and deleted_at is not null",
    [workspaceId, TITLE],
  );
  expect(removed.rows[0]?.count).toBe("1");

  // Applied and then undone. Both are true, and the record says both.
  const proposal = await pool.query<{ status: string; undone_at: Date | null }>(
    "select status, undone_at from proposed_changes where thread_id = $1",
    [threadId],
  );
  expect(proposal.rows[0]?.status).toBe("applied");
  expect(proposal.rows[0]?.undone_at).not.toBeNull();
});

/**
 * **A long conversation opens at its end** (plan 0.8.1 CP3, review F3).
 *
 * Acceptance criterion: given a thread taller than the panel, when the person
 * opens it, then the last turn is in view. The panel had no scroll handling,
 * so an opened thread started at its top and its newest turn was below the
 * fold. Written with SQL for the reason the file's header gives: no browser
 * here can make the copilot answer.
 */
test("a long conversation opens at its newest turn", async () => {
  const long = (
    await pool.query<{ id: string }>(
      `insert into ai_threads (id, workspace_id, member_id, title)
       values (gen_random_uuid(), $1, $2, 'A long conversation')
       returning id`,
      [workspaceId, memberId],
    )
  ).rows[0]?.id as string;
  for (let turn = 1; turn <= 12; turn += 1) {
    await pool.query(
      `insert into ai_messages (id, workspace_id, thread_id, role, content, created_at)
       values (gen_random_uuid(), $1, $2, 'member', $3, now() - make_interval(mins => $4)),
              (gen_random_uuid(), $1, $2, 'assistant', $5, now() - make_interval(mins => $4) + interval '5 seconds')`,
      [
        workspaceId,
        long,
        `Question number ${turn} about the onboarding quarter`,
        30 - turn,
        `Answer number ${turn}. ${"The onboarding work moved on this week, and the notes say why. ".repeat(4)}`,
      ],
    );
  }

  await page.goto("/");
  await openConversation("A long conversation");
  const panel = page.getByRole("dialog", { name: "Copilot" });

  await expect(panel.getByText("Answer number 12.", { exact: false })).toBeInViewport({
    timeout: 15_000,
  });
  await expect(
    panel.getByText("Question number 1 about", { exact: false }),
  ).not.toBeInViewport();
});

/**
 * **Deleting a conversation** (plan 0.8.1 CP2, review Q4).
 *
 * Acceptance criterion: given a conversation in History, when the person
 * deletes it, then it leaves the list, an audit row records
 * `copilot.deleteThread`, and its address answers not-found.
 */
test("a deleted conversation leaves History and its address says so", async () => {
  const panel = page.getByRole("dialog", { name: "Copilot" });
  const url = new URL(page.url());
  const id = url.searchParams.get("copilot");
  expect(id).toMatch(/^[0-9a-f-]{36}$/);

  await panel.getByRole("button", { name: "History" }).click();
  const history = panel.getByRole("navigation", { name: "History" });
  await history
    .getByRole("button", { name: "Delete A long conversation" })
    .click();
  // It asks first, in the row, because nothing brings it back.
  await expect(history.getByText("It cannot be brought back.")).toBeVisible();
  await history.getByRole("button", { name: "Delete", exact: true }).click();
  // Gone from the list, which is after the delete answered: the row asking
  // the question names it too, so its title is nowhere until both are gone.
  await expect(
    history.getByText("A long conversation", { exact: false }),
  ).toHaveCount(0, { timeout: 15_000 });

  const audit = await pool.query<{ action: string }>(
    "select action from audit_events where target_id = $1",
    [id],
  );
  expect(audit.rows.map((row) => row.action)).toContain("copilot.deleteThread");

  await page.goto(`/?copilot=${id}`);
  await expect(
    page
      .getByRole("dialog", { name: "Copilot" })
      .getByText("That conversation is not there any more."),
  ).toBeVisible({ timeout: 15_000 });
});

/**
 * **Edits and the mid-cycle reason** (plan 0.9.0 L4a, design §4.2 to §4.4).
 *
 * Acceptance criteria:
 *   Given a pending proposal to move a task, then the card reads
 *   `To do -> Done`, Apply moves the task and Undo moves it back.
 *   Given a workspace that requires a reason for a mid-cycle addition, when a
 *   pending objective proposal has no reason, then Apply waits until a reason
 *   is typed, and the objective is saved with those words.
 *
 * The proposals are inserted with SQL for the reason the file's header gives.
 * The task is made through the API with a token, the way `short-links.spec.ts`
 * makes its rows, so it has the access context a raw insert would lack.
 */
test.describe("edits and the reason", () => {
  let token = "";
  let spaceId: string;
  let taskId: string;

  const post = async (action: string, data: unknown) => {
    const response = await page.request.post(
      `/api/v1/${action.replace(".", "/")}`,
      { headers: { authorization: `Bearer ${token}` }, data },
    );
    expect(response.status(), `${action}: ${await response.text()}`).toBe(200);
    return (await response.json()).data as { id: string };
  };

  const proposalIn = async (
    title: string,
    action: string,
    payload: Record<string, unknown>,
    subject: [string, string],
  ): Promise<string> => {
    const thread = (
      await pool.query<{ id: string }>(
        `insert into ai_threads (id, workspace_id, member_id, title)
         values (gen_random_uuid(), $1, $2, $3) returning id`,
        [workspaceId, memberId, title],
      )
    ).rows[0]?.id as string;
    await pool.query(
      `insert into ai_messages (id, workspace_id, thread_id, role, content)
       values (gen_random_uuid(), $1, $2, 'member', $3)`,
      [workspaceId, thread, title],
    );
    await pool.query(
      `insert into proposed_changes
         (id, workspace_id, run_id, thread_id, action, payload, subject_type, subject_id, status, ai_generated)
       values (gen_random_uuid(), $1, null, $2, $3, $4::jsonb, $5, $6, 'pending', true)`,
      [
        workspaceId,
        thread,
        action,
        JSON.stringify(payload),
        subject[0],
        subject[1],
      ],
    );
    return thread;
  };

  const taskStatus = async (): Promise<string | undefined> =>
    (
      await pool.query<{ status: string }>(
        "select status from tasks where id = $1",
        [taskId],
      )
    ).rows[0]?.status;

  test("a task move reads before and after, applies, and undoes", async () => {
    await page.goto("/account/api-tokens");
    await page.getByLabel("Name").fill("Copilot edits e2e");
    await page.getByRole("checkbox", { name: "Write" }).check();
    await page.getByRole("button", { name: "Create token" }).click();
    const shown = page.getByTestId("minted-token");
    await expect(shown).toBeVisible({ timeout: 10_000 });
    token = ((await shown.textContent()) ?? "").trim();

    spaceId = (
      await pool.query<{ id: string }>(
        "select id from spaces where workspace_id = $1 and deleted_at is null order by created_at limit 1",
        [workspaceId],
      )
    ).rows[0]?.id as string;
    taskId = (
      await post("tasks.create", {
        spaceId,
        title: "Write the handover note",
        assigneeIds: [memberId],
      })
    ).id;
    await post("tasks.move", { id: taskId, status: "todo" });

    await proposalIn(
      "Move the handover task",
      "tasks.move",
      {
        id: taskId,
        status: "done",
        __preview: [
          { label: "Task", value: "Write the handover note" },
          { label: "Status", value: "To do -> Done" },
        ],
        __why: "You said the handover note is finished.",
      },
      ["task", taskId],
    );

    await page.goto("/");
    await openConversation("Move the handover task");
    const card = page
      .getByRole("dialog", { name: "Copilot" })
      .getByRole("region", { name: "Proposed change" });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText("Move task")).toBeVisible();
    await expect(card.getByText("To do -> Done")).toBeVisible();
    await expect(card.getByText("tasks.move")).toHaveCount(0);

    await card.getByRole("button", { name: "Apply" }).click();
    await expect(card.getByText("Applied")).toBeVisible({ timeout: 20_000 });
    expect(await taskStatus()).toBe("done");

    await card.getByRole("button", { name: "Undo" }).click();
    await expect(card.getByText("Undone")).toBeVisible({ timeout: 20_000 });
    expect(await taskStatus()).toBe("todo");
  });

  test("a card that needs a reason blocks Apply until one is typed", async () => {
    const cycle = (
      await pool.query<{
        id: string;
        starts_on: string;
        ends_on: string;
        published_at: Date | null;
      }>(
        `select c.id, c.starts_on::text, c.ends_on::text, c.published_at
           from cycles c
          where c.workspace_id = $1 and c.mode = 'quarterly' and c.deleted_at is null
          order by c.starts_on desc limit 1`,
        [workspaceId],
      )
    ).rows[0];
    if (!cycle) {
      throw new Error("No quarterly cycle to start an objective in.");
    }
    const title = `Reason required ${Date.now()}`;
    try {
      // Started five weeks ago and published: a start now is mid-cycle.
      await pool.query(
        `update cycles
            set starts_on = current_date - 35, ends_on = current_date + 30,
                published_at = now()
          where id = $1`,
        [cycle.id],
      );
      await post("practice.update", {
        overrides: { "reasons.midCycleAddition": "required" },
      });

      await proposalIn(
        "Start an objective mid-cycle",
        "goals.create",
        {
          title,
          cycleId: cycle.id,
          level: "team",
          ownerKind: "space",
          spaceId,
          championId: memberId,
          reviewerId: memberId,
          weight: 1,
          __preview: [
            { label: "Objective", value: title },
            { label: "Level", value: "team" },
          ],
          __why: "You asked for this objective.",
        },
        ["space", spaceId],
      );

      await page.goto("/");
      await openConversation("Start an objective mid-cycle");
      const card = page
        .getByRole("dialog", { name: "Copilot" })
        .getByRole("region", { name: "Proposed change" });
      await expect(card).toBeVisible({ timeout: 15_000 });
      const apply = card.getByRole("button", { name: "Apply" });
      const reason = card.getByLabel(
        "Why it starts now (required, it is added mid-cycle)",
      );
      await expect(reason).toBeVisible();
      await expect(apply).toBeDisabled();

      await reason.fill("The Growth team formed this month");
      await expect(apply).toBeEnabled();
      await apply.click();
      await expect(card.getByText("Applied")).toBeVisible({ timeout: 20_000 });

      const goal = (
        await pool.query<{ id: string }>(
          "select id from goals where workspace_id = $1 and title = $2 and deleted_at is null",
          [workspaceId, title],
        )
      ).rows[0];
      expect(goal?.id).toBeTruthy();
      const created = await pool.query<{ payload: { reason?: string } }>(
        "select payload from activities where subject_id = $1 and kind = 'goal.created'",
        [goal?.id],
      );
      expect(created.rows[0]?.payload.reason).toBe(
        "The Growth team formed this month",
      );
      // Leave the shared instance as it was found.
      await card.getByRole("button", { name: "Undo" }).click();
      await expect(card.getByText("Undone")).toBeVisible({ timeout: 20_000 });
    } finally {
      await post("practice.update", {
        overrides: { "reasons.midCycleAddition": "optional" },
      });
      await pool.query(
        `update cycles set starts_on = $2::date, ends_on = $3::date, published_at = $4
          where id = $1`,
        [cycle.id, cycle.starts_on, cycle.ends_on, cycle.published_at],
      );
    }
  });
});
