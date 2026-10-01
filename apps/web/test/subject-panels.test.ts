import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { withMessages } from "./screen-text.ts";

/**
 * Documents, files and the discussion on every surface the plans name them
 * (completeness review M-01).
 *
 * **The finding.** `SubjectDocuments` was mounted on one page, `Attachments`
 * took two subject types, and the goal page was the only page with a thread,
 * although REQUIREMENTS §4 puts documents on a goal, a key result, an
 * initiative, a session and a space (UIUX-PLAN S-29 adds a cycle), files on
 * any of those, and comments everywhere. The actions took every one of these
 * subjects already.
 *
 * What is checked is that each page mounts each panel for its own subject,
 * reads it through the one shared loader, and says nothing that stopped being
 * true. Who may read and write what is proved in `packages/core`, in
 * `subject-conversations.test.ts`.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const PAGES = {
  goal: "../app/goals/[id]/page.tsx",
  initiative: "../app/initiatives/[id]/page.tsx",
  task: "../app/tasks/[id]/page.tsx",
  document: "../app/documents/[id]/page.tsx",
  space: "../app/spaces/[id]/page.tsx",
  session: "../app/session/[id]/page.tsx",
  cycle: "../app/cycle/page.tsx",
} as const;

type Surface = keyof typeof PAGES;

/** Surface by panel, as the report for M-01 states it. */
const MOUNTS: Readonly<
  Record<Surface, { documents: boolean; files: boolean; comments: boolean }>
> = {
  goal: { documents: true, files: true, comments: true },
  initiative: { documents: true, files: true, comments: true },
  // REQUIREMENTS §4 does not hang documents on a task.
  task: { documents: false, files: true, comments: true },
  // A document is not hung on another document.
  document: { documents: false, files: true, comments: true },
  // Comments are not on a space or a session in TECHNICAL-PLAN §4.10, and a
  // cycle's thread has nowhere on S-04 that the plan draws it.
  space: { documents: true, files: true, comments: false },
  session: { documents: true, files: true, comments: false },
  cycle: { documents: true, files: true, comments: false },
};

describe.each(Object.keys(PAGES) as Surface[])("the %s page", (surface) => {
  const source = at(PAGES[surface]);
  const mounts = MOUNTS[surface];

  test(`${mounts.documents ? "mounts" : "does not mount"} the documents panel`, () => {
    const mounted = /<SubjectDocuments\s+subjectType="(\w+)"/.exec(source);
    if (mounts.documents) {
      expect(mounted?.[1]).toBe(surface);
      // Through the shared read, so the draft rule's list is the one drawn.
      expect(source).toContain(`readSubjectDocuments(`);
    } else {
      expect(mounted).toBeNull();
    }
  });

  test("mounts the files panel for its own subject", () => {
    expect(/<Attachments\s+subjectType="(\w+)"/.exec(source)?.[1]).toBe(
      surface,
    );
    expect(source).toContain('"attachments.list"');
  });

  test(`${mounts.comments ? "mounts" : "does not mount"} the discussion`, () => {
    const mounted = /<SubjectComments\s+subjectType="(\w+)"/.exec(source);
    if (mounts.comments) {
      expect(mounted?.[1]).toBe(surface);
      expect(source).toContain(`readConversation(context, "${surface}", id)`);
    } else {
      expect(mounted).toBeNull();
    }
  });
});

describe("one thread, one set of writes", () => {
  test("the goal page no longer keeps a thread of its own", () => {
    const goal = at(PAGES.goal);
    expect(goal).not.toContain("GoalComments");
    expect(goal).not.toContain('"reactions.list"');
    expect(at("../app/goals/[id]/actions.ts")).not.toContain(
      '"comments.create"',
    );
  });

  test("the writes post to the subject they are given, not to a goal", () => {
    const actions = at("../lib/comment-actions.ts");
    expect(actions).toContain('"comments.create"');
    expect(actions).toContain("subjectType: input.subjectType");
    const wired = at("../lib/subject-comments.tsx");
    expect(wired).toContain("postComment({ subjectType, subjectId, body })");
    expect(wired).not.toMatch(/subjectType[=:]\s*"goal"/);
  });

  test("the subject itself takes reactions, above its thread", () => {
    const wired = at("../lib/subject-comments.tsx");
    expect(wired).toContain("<ReactionRow");
    expect(wired).toContain("toggleReaction(");
    const loader = at("../lib/conversation.ts");
    // The subject's own reactions, and each comment's.
    expect(loader).toContain(
      'callAction(context, "reactions.list", { subjectType, subjectId })',
    );
    expect(loader).toContain('subjectType: "comment"');
  });

  test("a refused write is said, not swallowed", () => {
    const wired = at("../lib/subject-comments.tsx");
    expect(wired).toContain('role="alert"');
  });
});

describe("what the pages stopped saying", () => {
  test("the task page no longer says comments and files are not kept on a task", () => {
    const task = withMessages(at(PAGES.task));
    expect(task).not.toContain("not kept on a task");
    expect(task).not.toContain("tasks.detail.whatIsNotHere");
  });

  test("a draft document has no thread, because a draft has no discussion", () => {
    const document = at(PAGES.document);
    expect(document).toContain('document.state === "published"');
    expect(document).toContain("{conversation ? (");
  });

  test("a session a guest cannot read its documents for still renders", () => {
    const session = at(PAGES.session);
    expect(session).toContain(".catch(refusedAsNull)");
  });
});
