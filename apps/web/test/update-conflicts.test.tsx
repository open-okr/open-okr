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
 * The edit screens' half of optimistic concurrency
 * (docs/design/optimistic-concurrency.md V4, plan 0.7.0 D3).
 *
 * Each screen's save sends only the fields the person changed, each with
 * the value the screen read, and a field somebody else changed since comes
 * back as a conflict the screen shows with keep mine and take theirs. The
 * comparison itself is the server's, proved against a database in
 * `packages/core/test/optimistic-concurrency.test.ts`.
 */

const callAction = vi.fn();
const refresh = vi.fn();

vi.mock("@openokr/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openokr/core")>()),
  callAction: (...args: unknown[]) => callAction(...args),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: () => undefined }),
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
    workspace: { workspaceId: "workspace-1" },
  }),
}));

const { onlyChanged, conflictOf } = await import("../lib/conflict.ts");
const { updateSpace } = await import("../app/spaces/actions.ts");
const { updateKpiRule } = await import("../app/kpis/actions.ts");
const { saveCycleSetup } = await import("../app/cycle/setup-actions.ts");
const { updateCycleDates } = await import("../app/cycle/admin-actions.ts");
const { setCapacityAction, setStatusAction } = await import(
  "../app/initiatives/actions.ts"
);
const { setDueOnAction } = await import("../app/board/actions.ts");
const { ActionForm } = await import("../app/cycle/action-form.tsx");

const NONE = { error: null };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

/** What the server answers when a field moved since it was read. */
const moved = (current: Record<string, unknown>) =>
  new OperationError("conflict", "Mei changed this since you read it.", {
    current,
    changedBy: "Mei",
    changedAt: "2026-11-10T00:00:00.000Z",
  });

beforeEach(() => {
  callAction.mockReset();
  callAction.mockResolvedValue({ id: "space-1" });
  refresh.mockReset();
});

describe("only what changed is sent, with what was read for it", () => {
  it("leaves out a field that reads as it was read", () => {
    expect(
      onlyChanged(
        { name: "Support", mission: "Answer the same day" },
        { name: "Customer Success", mission: "Answer the same day" },
      ),
    ).toEqual({
      set: { name: "Support" },
      read: { name: "Customer Success" },
    });
  });

  it("sends everything, as before, when the form read nothing", () => {
    expect(onlyChanged({ name: "Support", mission: null }, null)).toEqual({
      set: { name: "Support", mission: null },
      read: undefined,
    });
  });

  it("is not fooled by blank text or a number read as text", () => {
    expect(
      onlyChanged(
        { mission: null, greenLow: 99.9 },
        {
          mission: "",
          greenLow: "99.90",
        },
      ).set,
    ).toEqual({});
  });

  it("tells a stale read from a name already taken, which is a refusal", () => {
    expect(conflictOf(moved({ name: "Support" }), { name: "Sales" })).toEqual({
      current: { name: "Support" },
      changedBy: "Mei",
      mine: { name: "Sales" },
    });
    expect(
      conflictOf(
        new OperationError("conflict", "Taken.", undefined, "name"),
        {},
      ),
    ).toBeNull();
  });
});

describe("the space form", () => {
  const read = JSON.stringify({ name: "Customer Success", mission: null });

  it("sends the name it changed and not the mission it left", async () => {
    await updateSpace(
      NONE,
      form({ id: "s", name: "Support", mission: "", read }),
    );
    expect(callAction.mock.calls[0]?.[2]).toEqual({
      id: "s",
      name: "Support",
      read: { name: "Customer Success" },
    });
  });

  it("saves nothing when nothing changed", async () => {
    expect(
      await updateSpace(
        NONE,
        form({ id: "s", name: "Customer Success", mission: "", read }),
      ),
    ).toMatchObject({ error: null, saved: true });
    expect(callAction).not.toHaveBeenCalled();
  });

  it("answers a stale read with what is stored and what was sent", async () => {
    callAction.mockRejectedValue(moved({ name: "Customer Care" }));
    expect(
      await updateSpace(
        NONE,
        form({ id: "s", name: "Support", mission: "", read }),
      ),
    ).toEqual({
      error: null,
      conflict: {
        current: { name: "Customer Care" },
        changedBy: "Mei",
        mine: { name: "Support" },
      },
    });
  });
});

describe("the other edit screens send what they read", () => {
  it("the KPI rule sends only the tier when only the tier changed", async () => {
    callAction.mockResolvedValue({ id: "k" });
    const read = JSON.stringify({
      targetType: "at_least",
      greenLow: 99.9,
      greenHigh: null,
      redLow: 99.5,
      redHigh: null,
      ownerMemberId: null,
      tier: null,
    });
    await updateKpiRule(
      NONE,
      form({
        kpiId: "k",
        targetType: "at_least",
        green: "99.9",
        red: "99.5",
        tier: "impact",
        ownerMemberId: "",
        read,
      }),
    );
    expect(callAction.mock.calls[0]?.[2]).toEqual({
      kpiId: "k",
      tier: "impact",
      read: { tier: null },
    });
  });

  it("the cycle setup sends nothing when nothing changed", async () => {
    const read = JSON.stringify({
      sponsorId: null,
      facilitatorId: null,
      firstCycle: false,
      sessionDates: [{ key: "draft", on: "2027-03-20" }],
    });
    await saveCycleSetup(
      NONE,
      form({ cycleId: "c", "session-draft": "2027-03-20", read }),
    );
    expect(callAction).not.toHaveBeenCalled();
  });

  it("the deadline, a status, a verdict and a due date each send their read", async () => {
    callAction.mockResolvedValue({});
    await updateCycleDates({
      id: "c",
      publicationDeadline: "2027-03-25",
      read: { publicationDeadline: null },
    });
    await setStatusAction("i", "active", "planned");
    await setCapacityAction("i", "tight", "");
    await setDueOnAction("t", "2026-12-01", "");
    expect(callAction.mock.calls.map((call) => call[2])).toEqual([
      {
        id: "c",
        publicationDeadline: "2027-03-25",
        read: { publicationDeadline: null },
      },
      { id: "i", status: "active", read: { status: "planned" } },
      { id: "i", capacity: "tight", read: { capacity: null } },
      { id: "t", dueOn: "2026-12-01", read: { dueOn: null } },
    ]);
  });

  it("a status or a due date somebody moved comes back as a conflict", async () => {
    callAction.mockRejectedValue(moved({ status: "done" }));
    expect(await setStatusAction("i", "active", "planned")).toEqual({
      error: null,
      conflict: {
        current: { status: "done" },
        changedBy: "Mei",
        mine: { status: "active" },
      },
    });
    callAction.mockRejectedValue(moved({ dueOn: "2026-12-05" }));
    expect(await setDueOnAction("t", "2026-12-01", "")).toMatchObject({
      conflict: { current: { dueOn: "2026-12-05" } },
    });
  });
});

describe("a form with a read offers keep mine and take theirs", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const action = vi.fn();

  const draw = () =>
    act(() =>
      root.render(
        <TranslationsProvider locale="en">
          <ActionForm action={action} read={{ name: "Customer Success" }}>
            <TextInput
              label="Name"
              name="name"
              defaultValue="Customer Success"
            />
            <button type="submit">Save</button>
          </ActionForm>
        </TranslationsProvider>,
      ),
    );

  const submit = async () => {
    const input = host.querySelector("input[name='name']") as HTMLInputElement;
    input.value = "Support";
    await act(async () => {
      (
        host.querySelector("button[type='submit']") as HTMLButtonElement
      ).click();
    });
  };

  const button = (name: string) =>
    [...host.querySelectorAll("button")].find(
      (one) => one.textContent === name,
    ) as HTMLButtonElement;

  it("keep mine sends it again, read as what is stored now", async () => {
    action.mockReset();
    action.mockResolvedValueOnce({
      error: null,
      conflict: {
        current: { name: "Customer Care" },
        changedBy: "Mei",
        mine: { name: "Support" },
      },
    });
    action.mockResolvedValueOnce({ error: null });
    draw();
    await submit();

    const notice = host.querySelector("[data-testid='conflict']");
    expect(notice?.textContent).toContain(
      'Mei changed this since you read it, and it now reads "Customer Care".',
    );
    expect(notice?.textContent).toContain('You had "Support".');

    await act(async () => button("Keep mine").click());
    const again = action.mock.calls[1]?.[1] as FormData;
    expect(again.get("name")).toBe("Support");
    expect(JSON.parse(String(again.get("read")))).toEqual({
      name: "Customer Care",
    });
    expect(host.querySelector("[data-testid='conflict']")).toBeNull();
  });

  it("take theirs puts the notice away and reads the page again", async () => {
    action.mockReset();
    action.mockResolvedValueOnce({
      error: null,
      conflict: {
        current: { name: "Customer Care" },
        changedBy: "Mei",
        mine: { name: "Support" },
      },
    });
    draw();
    await submit();
    await act(async () => button("Take theirs").click());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1);
    expect(host.querySelector("[data-testid='conflict']")).toBeNull();
  });
});
