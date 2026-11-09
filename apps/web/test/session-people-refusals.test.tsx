// @vitest-environment jsdom
import { OperationError } from "@openokr/core";
import {
  CATALOGUES,
  TextInput,
  TranslationsProvider,
  translate,
} from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sessions, people, check-in, review and inbox, refused under the field they
 * are about (guided-inputs §4.2, plan 0.7.0 U1b).
 *
 * The session stage's forms, the schedule form, the check-in composer and
 * blocker, and the person form on a profile all hand a refused field to the
 * field. The review and inbox buttons draw no field and keep the sentence.
 */

const callAction = vi.fn();
const redirect = vi.fn();

vi.mock("@openokr/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openokr/core")>()),
  callAction: (...args: unknown[]) => callAction(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirect(...args),
}));
vi.mock("../lib/auth", () => ({ getPool: () => ({ pool: true }) }));
vi.mock("../lib/pool", () => ({ getPool: () => ({ pool: true }) }));
vi.mock("../lib/translations", () => ({
  getTranslations: async () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      translate(CATALOGUES.en, key, values),
  }),
}));
vi.mock("../lib/workspace", () => ({
  requireWorkspace: async () => ({
    session: { user: { id: "user-1" } },
    workspace: { workspaceId: "workspace-1", memberId: "member-1" },
  }),
}));

const { raiseBlockerAction, reassignBlockerAction, setCoordinatorNoteAction } =
  await import("../app/session/[id]/blocker-actions.ts");
const { closeCommitmentsAction } = await import(
  "../app/session/[id]/commitment-actions.ts"
);
const { bookCycleAction } = await import("../app/sessions/schedule-actions.ts");
const { updateMemberFields, updateProfile } = await import(
  "../app/people/actions.ts"
);
const { eraseMemberAction } = await import(
  "../app/people/lifecycle-actions.ts"
);
const { publishCheckIn } = await import("../app/check-in/actions.ts");
const { markRead } = await import("../app/inbox/actions.ts");
const { MemberFieldsForm } = await import(
  "../app/people/[id]/member-fields-form.tsx"
);

const en = (key: string, values?: Record<string, string | number>) =>
  translate(CATALOGUES.en, key, values);
const NONE = { error: null };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

const zodError = (issues: readonly Record<string, unknown>[]) =>
  Object.assign(new Error(JSON.stringify(issues)), {
    name: "ZodError",
    issues,
  });

const PARAGRAPH = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Fine" }] }],
});

beforeEach(() => {
  callAction.mockReset();
  callAction.mockResolvedValue({ booked: 1, missing: [] });
  redirect.mockReset();
});

describe("the session room's forms", () => {
  it("name the field a blocker, a move or a note is missing, under it", async () => {
    expect(
      await raiseBlockerAction(
        NONE,
        form({ sessionId: "s", keyResultId: "k", type: "dependency" }),
      ),
    ).toEqual({
      error: null,
      fields: { ownerId: en("session.detail.actions.somebodyOwnsClearingIt") },
    });
    expect(await reassignBlockerAction(NONE, form({ blockerId: "b" }))).toEqual(
      {
        error: null,
        fields: { ownerId: en("session.detail.actions.chooseWhoItMovesTo") },
      },
    );
    expect(
      await setCoordinatorNoteAction(NONE, form({ sessionId: "s" })),
    ).toEqual({
      error: null,
      fields: { note: en("session.detail.actions.writeTheNoteFirst") },
    });
  });

  it("puts a refused line on why under that commitment's own line", async () => {
    callAction.mockRejectedValue(
      zodError([
        {
          code: "too_big",
          origin: "string",
          maximum: 300,
          path: ["items", 0, "note"],
          message: "Too big: expected string to have <=300 characters",
        },
      ]),
    );
    const data = form({ sessionId: "s", "verdict:c-1": "no", "note:c-1": "x" });
    expect(await closeCommitmentsAction(NONE, data)).toEqual({
      error: null,
      fields: { "note:c-1": en("fields.tooLong", { max: 300 }) },
    });
  });

  it("the schedule form puts a refused time under the time, and keeps its shape", async () => {
    callAction.mockRejectedValue(
      zodError([{ code: "custom", path: ["time"], message: "Not a time." }]),
    );
    expect(
      await bookCycleAction(
        { error: null, notice: null, details: [] },
        form({ spaceId: "s", weekday: "1", time: "25:00", facilitatorId: "m" }),
      ),
    ).toEqual({
      error: null,
      notice: null,
      details: [],
      fields: { time: "Not a time." },
    });
  });
});

describe("a check-in", () => {
  it("puts a refused value under that key result's box, and does not move on", async () => {
    callAction.mockRejectedValue(
      new OperationError(
        "forbidden",
        "Above the target.",
        undefined,
        "values.0.value",
      ),
    );
    const data = form({
      checkInId: "c",
      narrative: PARAGRAPH,
      confidence: "0.6",
      status: "on_track",
      "value:k-1": "40",
    });
    // Where a published extra update returns to, which a refusal must not.
    data.set("then", "/check-in?goal=11111111-1111-4111-8111-111111111111");
    expect(await publishCheckIn(NONE, data)).toEqual({
      error: null,
      fields: { "value:k-1": "Above the target." },
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("asks for the confidence under the confidence", async () => {
    expect(
      await publishCheckIn(
        NONE,
        form({ checkInId: "c", narrative: PARAGRAPH }),
      ),
    ).toEqual({
      error: null,
      fields: { confidence: en("checkIn.actions.confidenceNeeded") },
    });
  });
});

describe("a person's profile", () => {
  it("an administrator's edit puts a refused name under the name", async () => {
    callAction.mockRejectedValue(
      zodError([
        {
          code: "too_big",
          origin: "string",
          maximum: 200,
          path: ["name"],
          message: "Too big: expected string to have <=200 characters",
        },
      ]),
    );
    expect(
      await updateMemberFields(null, form({ memberId: "m", name: "Priya" })),
    ).toEqual({
      ok: false,
      message: "",
      fields: { name: en("fields.tooLong", { max: 200 }) },
    });
  });

  it("one quiet hour without the other, under the empty one", async () => {
    expect(
      await updateProfile(
        null,
        form({ memberId: "m", quietStart: "22:00", quietEnd: "" }),
      ),
    ).toEqual({
      ok: false,
      message: "",
      fields: { quietEnd: en("common.quietHoursNeedBothTimes") },
    });
  });

  it("an erasure with the name typed differently, under the typed name", async () => {
    callAction.mockResolvedValue({ name: "Ben Ortiz" });
    expect(
      await eraseMemberAction(
        { kind: "idle" },
        form({ memberId: "m", confirmName: "Ben" }),
      ),
    ).toEqual({
      kind: "refused",
      message: en("people.actions.typeTheNameExactly", { name: "Ben Ortiz" }),
      field: "confirmName",
    });
  });
});

describe("the inbox's buttons", () => {
  it("keep the sentence, a schema's included", async () => {
    callAction.mockRejectedValue(
      zodError([
        { code: "custom", path: ["notificationId"], message: "Not an id." },
      ]),
    );
    expect(await markRead(NONE, form({ notificationId: "x" }))).toEqual({
      error: "Not an id.",
    });
  });
});

describe("MemberFieldsForm", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows a refused field under the field the page drew, and no sentence", async () => {
    const action = async () => ({
      ok: false,
      message: "",
      fields: { name: "Up to 200 characters." },
    });
    await act(async () => {
      root.render(
        <TranslationsProvider locale="en">
          <MemberFieldsForm action={action}>
            <TextInput label="Name" name="name" />
          </MemberFieldsForm>
        </TranslationsProvider>,
      );
    });
    await act(async () => {
      container.querySelector("form")?.requestSubmit();
    });
    const alerts = [...container.querySelectorAll('[role="alert"]')];
    expect(alerts.map((one) => one.textContent)).toEqual([
      "Up to 200 characters.",
    ]);
    expect(
      container
        .querySelector<HTMLInputElement>('input[name="name"]')
        ?.getAttribute("aria-invalid"),
    ).toBe("true");
  });
});
