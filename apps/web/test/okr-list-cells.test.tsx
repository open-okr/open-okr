// @vitest-environment jsdom
import {
  canonThresholds,
  defaultPractice,
  resolvePractice,
} from "@openokr/method";
import {
  QueryClient,
  QueryClientProvider,
  ToastProvider,
  TranslationsProvider,
} from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { OkrTree } from "../lib/okr-tree/cache.ts";

/**
 * The OKR list's cells, each edited where it is read (P9-T07a-a,
 * docs/design/p9-t00-okr-writing.md §4.2 and §4.5).
 *
 * **The real table, rendered in jsdom**, with the server action that writes
 * stubbed, because every claim here is about what one keystroke sends and
 * what the reader then sees: the field it came from, the values it read, the
 * reason an eased target asks for, the coaching that appears while typing,
 * and a refused change kept with its sentence. What the writes do on the
 * server is proved in `packages/core/test/goal-tree.test.ts` and
 * `goal-targets.test.ts`, and the keyboard path end to end in
 * `e2e/s13-okr-editor.spec.ts`.
 */

const runOkrMutation = vi.fn();
vi.mock("../lib/okr-tree/actions.ts", () => ({
  readOkrDetail: vi.fn(),
  readOkrTree: vi.fn(),
  runOkrMutation: (...args: unknown[]) => runOkrMutation(...args),
}));
vi.mock("../app/goals/editor-actions.ts", () => ({
  addKeyResult: vi.fn(),
  addObjective: vi.fn(),
  removeGoal: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

class Quiet {
  onmessage = null;
  postMessage() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

const { OkrTable } = await import("../app/goals/okr-table.tsx");

const MEI = { id: "00000000-0000-7000-8000-000000000002", name: "Mei" };
const PRIYA = { id: "00000000-0000-7000-8000-000000000001", name: "Priya" };

type FixtureKeyResult = OkrTree["goals"][number]["keyResults"][number];

const tree = (over: Partial<FixtureKeyResult> = {}): OkrTree => ({
  cycle: {
    id: "c",
    name: "Q1",
    mode: "quarterly",
    startsOn: "2027-01-01",
    endsOn: "2027-03-31",
    midCycle: false,
  },
  viewerId: "00000000-0000-4000-8000-000000000001",
  goals: [
    {
      id: "g",
      title: "Make onboarding the reason teams stay",
      cycleId: "c",
      level: "team",
      kind: "aspirational",
      addedMidCycleAt: null,
      draft: null,
      draftState: null,
      spaceId: null,
      champion: PRIYA,
      reviewer: null,
      parentGoalId: null,
      parentKeyResultId: null,
      weight: 1,
      contributionStatement: null,
      progressPct: 20,
      health: "on_track",
      closedAt: null,
      nextCheckInOn: "2027-01-11",
      daysPastDue: null,
      position: 0,
      quality: { score: null, flags: [] },
      keyResults: [
        {
          id: "k",
          goalId: "g",
          title: "Activation from 30% to 45%",
          unit: "%",
          kind: "metric",
          doneAt: null,
          addedMidCycleAt: null,
          draft: null,
          direction: "increase",
          indicatorType: "lagging",
          baselineValue: 30,
          targetValue: 45,
          currentValue: 33,
          dueOn: "2027-03-31",
          owner: MEI,
          weight: 1,
          kpiId: null,
          progressPct: 20,
          confidence: 0.6,
          qualityFlags: [],
          position: 0,
          ...over,
        },
      ],
    },
  ],
  context: [],
  dependencies: [],
});

let root: Root;
let container: HTMLDivElement;

async function render(options: {
  canEdit?: boolean;
  practice?: ReturnType<typeof defaultPractice>;
  keyResult?: Partial<FixtureKeyResult>;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <TranslationsProvider locale="en">
          <ToastProvider>
            <OkrTable
              initialTree={tree(options.keyResult)}
              initialAt={Date.now()}
              scope="all"
              filters={{ includeClosed: false }}
              spaces={[]}
              cycleId="c"
              level="team"
              canEdit={options.canEdit ?? true}
              canAdminister={options.canEdit ?? true}
              progressMax={100}
              members={[PRIYA, MEI]}
              refusal={null}
              coach={{
                thresholds: canonThresholds(),
                practice: options.practice ?? defaultPractice(),
              }}
              empty={<p>Nothing matches</p>}
            />
          </ToastProvider>
        </TranslationsProvider>
      </QueryClientProvider>,
    );
  });
}

const field = (label: string) =>
  container.querySelector<HTMLInputElement | HTMLSelectElement>(
    `[aria-label="${label}"]`,
  );

/** Types into a field the way React hears it, then leaves it. */
async function type(label: string, value: string) {
  const input = field(label) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    input.focus();
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

async function leave(input: HTMLInputElement) {
  await act(async () => {
    input.blur();
  });
  await act(async () => new Promise((done) => setTimeout(done)));
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("BroadcastChannel", Quiet);
  vi.stubGlobal("EventSource", Quiet);
  runOkrMutation.mockReset();
  runOkrMutation.mockResolvedValue({ ok: true, goal: null });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("a title", () => {
  test("is sent with the value it was read as", async () => {
    await render({});
    await leave(
      await type("Objective title", "Make onboarding the reason teams renew"),
    );
    expect(runOkrMutation).toHaveBeenCalledWith({
      kind: "patchGoal",
      id: "g",
      set: { title: "Make onboarding the reason teams renew" },
      read: { title: "Make onboarding the reason teams stay" },
    });
  });

  test("coaches as the reader types, before anything is saved", async () => {
    await render({});
    await type("Objective title", "Launch the new mobile app");
    const chips = container.querySelector('[data-testid="live-verdicts"]');
    expect(chips?.textContent).toContain("OBJ-1");
    expect(runOkrMutation).not.toHaveBeenCalled();
  });
});

describe("the kind (METHOD.md §2.8, P9-T11b-a)", () => {
  const LABEL = "Kind of Make onboarding the reason teams stay";

  async function choose(value: string) {
    const select = field(LABEL) as HTMLSelectElement;
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  test("asks why before it sends a change, and sends the answer with it", async () => {
    await render({});
    await choose("committed");
    expect(runOkrMutation).not.toHaveBeenCalled();
    const reason = await type(
      "Marking it committed. Why?",
      "The board made it a promise",
    );
    await act(async () => {
      reason.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(runOkrMutation).toHaveBeenCalledWith({
      kind: "setKind",
      id: "g",
      okrKind: "committed",
      reason: "The board made it a promise",
    });
  });

  test("sends a change with no reason, because one is asked for and not required", async () => {
    await render({});
    await choose("committed");
    const save = [...container.querySelectorAll("button")].find(
      (button) =>
        button.closest('[data-testid="kind-reason"]') &&
        button.textContent === "Save",
    );
    await act(async () => save?.click());
    expect(runOkrMutation).toHaveBeenCalledWith({
      kind: "setKind",
      id: "g",
      okrKind: "committed",
    });
  });

  test("keeps the kind it had on Escape", async () => {
    await render({});
    await choose("committed");
    const reason = field("Marking it committed. Why?") as HTMLInputElement;
    await act(async () => {
      reason.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(runOkrMutation).not.toHaveBeenCalled();
    expect((field(LABEL) as HTMLSelectElement).value).toBe("aspirational");
    expect(container.querySelector('[data-testid="kind-reason"]')).toBeNull();
  });

  test("is a chip, not a control, for a reader who cannot edit", async () => {
    await render({ canEdit: false });
    expect(field(LABEL)).toBeNull();
    expect(
      container.querySelector('[data-kind="aspirational"]')?.textContent,
    ).toBe("Aspirational");
  });

  test("is not shown at all where the workspace uses one kind", async () => {
    await render({
      practice: resolvePractice("recommended", {
        "okr.kinds": "aspirationalOnly",
      }),
    });
    expect(field(LABEL)).toBeNull();
    expect(container.querySelector("[data-kind]")).toBeNull();
  });
});

describe("the key result's kind (METHOD.md §2.10, P9-T12c-a)", () => {
  async function choose(label: string, value: string) {
    const select = field(label) as HTMLSelectElement;
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  test("is chosen in the row, compared with the kind it was read as", async () => {
    await render({});
    // A metric's value field, by the label the milestone test expects gone.
    expect(
      field("Current value for Activation from 30% to 45%"),
    ).not.toBeNull();
    await choose("Kind of key result Activation from 30% to 45%", "milestone");
    expect(runOkrMutation).toHaveBeenCalledWith({
      kind: "patchKeyResult",
      id: "k",
      set: { kind: "milestone" },
      read: { kind: "metric" },
    });
  });

  test("offers only the kinds the workspace uses", async () => {
    await render({
      practice: resolvePractice("recommended", {
        "keyResultKinds.baseline": "off",
      }),
    });
    const options = [
      ...((
        field(
          "Kind of key result Activation from 30% to 45%",
        ) as HTMLSelectElement
      )?.options ?? []),
    ].map((option) => option.value);
    expect(options).toEqual(["metric", "maintain", "milestone"]);
  });

  test("asks a milestone only whether it is done, and ticking it sends done", async () => {
    await render({
      keyResult: {
        title: "No one on the team experienced a major injury",
        kind: "milestone",
      },
    });
    expect(
      field("Current value for No one on the team experienced a major injury"),
    ).toBeNull();

    const done = field(
      "No one on the team experienced a major injury is done",
    ) as HTMLInputElement;
    expect(done.checked).toBe(false);
    await act(async () => done.click());
    expect(runOkrMutation).toHaveBeenCalledWith({
      kind: "patchKeyResult",
      id: "k",
      set: { done: true },
      read: { done: false },
    });
  });

  test("asks a baseline nobody has recorded for its first value, from an empty field", async () => {
    await render({
      keyResult: {
        title: "Establish an onboarding NPS baseline",
        kind: "baseline",
      },
    });
    const baseline = field(
      "The baseline for Establish an onboarding NPS baseline",
    ) as HTMLInputElement;
    expect(baseline.value).toBe("");
    await leave(
      await type("The baseline for Establish an onboarding NPS baseline", "31"),
    );
    expect(runOkrMutation).toHaveBeenCalledWith({
      kind: "recordValue",
      id: "k",
      value: 31,
    });
  });
});

describe("a target", () => {
  test("made harder is sent at once, with no reason asked", async () => {
    await render({});
    await leave(await type("Target for Activation from 30% to 45%", "50"));
    expect(runOkrMutation).toHaveBeenCalledWith({
      kind: "changeTarget",
      id: "k",
      targetValue: 50,
    });
    expect(container.querySelector('[data-testid="target-reason"]')).toBeNull();
  });

  test("eased asks why under the row, and sends the reason with it", async () => {
    await render({});
    await leave(await type("Target for Activation from 30% to 45%", "40"));
    expect(runOkrMutation).not.toHaveBeenCalled();
    const reason = container.querySelector('[data-testid="target-reason"]');
    expect(reason?.textContent).toContain("Easing the target from 45 to 40");

    const box = reason?.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(box, "The partner channel closed in week three");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      box.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(runOkrMutation).toHaveBeenCalledWith({
      kind: "changeTarget",
      id: "k",
      targetValue: 40,
      reason: "The partner channel closed in week three",
    });
  });

  test("eased is sent without a reason where the workspace made it optional", async () => {
    await render({
      practice: resolvePractice("recommended", {
        "reasons.easingTarget": "optional",
      }),
    });
    await leave(await type("Target for Activation from 30% to 45%", "40"));
    expect(runOkrMutation).toHaveBeenCalledWith({
      kind: "changeTarget",
      id: "k",
      targetValue: 40,
    });
  });
});

describe("the other cells", () => {
  test("an owner is chosen from the people who can own one", async () => {
    await render({});
    const picker = field(
      "Owner of Activation from 30% to 45%",
    ) as HTMLSelectElement;
    await act(async () => {
      picker.value = PRIYA.id;
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(runOkrMutation).toHaveBeenCalledWith({
      kind: "patchKeyResult",
      id: "k",
      set: { ownerId: PRIYA.id },
      read: { ownerId: MEI.id },
    });
  });

  test("a due date and a baseline each send only themselves", async () => {
    await render({});
    await leave(
      await type("Due date for Activation from 30% to 45%", "2027-03-15"),
    );
    expect(runOkrMutation).toHaveBeenLastCalledWith({
      kind: "patchKeyResult",
      id: "k",
      set: { dueOn: "2027-03-15" },
      read: { dueOn: "2027-03-31" },
    });
    await leave(await type("Baseline for Activation from 30% to 45%", "28"));
    expect(runOkrMutation).toHaveBeenLastCalledWith({
      kind: "patchKeyResult",
      id: "k",
      set: { baselineValue: 28 },
      read: { baselineValue: 30 },
    });
  });

  test("an unchanged value sends nothing", async () => {
    await render({});
    await leave(
      await type("Objective title", "Make onboarding the reason teams stay"),
    );
    expect(runOkrMutation).not.toHaveBeenCalled();
  });
});

describe("the states", () => {
  test("a reader who cannot edit sees values, and nothing to edit them with", async () => {
    await render({ canEdit: false });
    expect(container.querySelectorAll("input, select")).toHaveLength(0);
    expect(container.textContent).toContain(
      "Make onboarding the reason teams stay",
    );
    expect(container.textContent).not.toContain("Add key result");
  });

  test("a refused change keeps what was typed, with the sentence and Retry", async () => {
    await render({});
    runOkrMutation.mockResolvedValueOnce({
      ok: false,
      error: "This workspace refuses that.",
    });
    await leave(await type("Key result title", "Activation to 45%"));
    const refused = container.querySelector('[data-testid="okr-refused"]');
    expect(refused?.textContent).toContain(
      "Not saved: This workspace refuses that.",
    );

    const retry = [...(refused?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Retry",
    );
    await act(async () => retry?.click());
    expect(runOkrMutation).toHaveBeenLastCalledWith({
      kind: "patchKeyResult",
      id: "k",
      set: { title: "Activation to 45%" },
      read: { title: "Activation from 30% to 45%" },
    });
  });
});
