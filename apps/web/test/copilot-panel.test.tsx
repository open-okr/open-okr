// @vitest-environment jsdom
import { KeyboardRegistryProvider, TranslationsProvider } from "@openokr/ui";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CopilotAvailability } from "../app/copilot/actions.ts";

/**
 * The copilot panel in a browser (screen S-39, plan 0.8.1 W3).
 *
 * The end-to-end instance has no AI provider, so everything that needs an
 * answer to arrive is proved here against a scripted stream: the server
 * actions are stubbed and `fetch` answers with the Server-Sent Events the
 * route would send.
 */

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const actions = vi.hoisted(() => ({
  applyCopilotProposalAction: vi.fn(),
  copilotAvailabilityAction: vi.fn(),
  dismissCopilotProposalAction: vi.fn(),
  deleteCopilotThreadAction: vi.fn(),
  listCopilotProposalsAction: vi.fn(async (): Promise<unknown[]> => []),
  listCopilotThreadsAction: vi.fn(async (): Promise<unknown[]> => []),
  readCopilotThreadAction: vi.fn(),
  stopCopilotRunAction: vi.fn(async () => ({})),
  undoCopilotProposalAction: vi.fn(),
}));
vi.mock("../app/copilot/actions", () => actions);
// The address the panel reads and writes (plan 0.8.1 CP2): the window's own,
// as Next's router reports it after a history call.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
}));

const { CopilotPanel } = await import("../app/copilot/copilot-panel");
const { nextShownStep } = await import("../app/copilot/step-line");

const AVAILABLE: CopilotAvailability = {
  available: true,
  providerConfigured: true,
  reason: null,
  searchAvailable: true,
  streaming: true,
  resetsAt: null,
  fixes: [],
};

const AI_OFF: CopilotAvailability = {
  available: false,
  providerConfigured: false,
  reason:
    "No AI provider is configured, so the copilot can find sources but cannot write an answer.",
  searchAvailable: true,
  streaming: false,
  resetsAt: null,
  fixes: [],
};

const THREAD = "00000000-0000-4000-8000-000000000001";
const QUESTION_ID = "00000000-0000-4000-8000-000000000002";

/** A response whose body is these events, as the route frames them. */
function streamOf(events: readonly Record<string, unknown>[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(
            `event: ${String(event.kind)}\ndata: ${JSON.stringify(event)}\n\n`,
          ),
        );
      }
      controller.close();
    },
  });
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

let host: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

const render = async (availability: CopilotAvailability) => {
  actions.copilotAvailabilityAction.mockResolvedValue(availability);
  await act(async () => {
    root.render(
      <TranslationsProvider locale="en">
        <KeyboardRegistryProvider>
          <CopilotPanel initialAvailability={availability} />
        </KeyboardRegistryProvider>
      </TranslationsProvider>,
    );
  });
};

const panel = () => document.querySelector<HTMLElement>('[role="dialog"]');

const byName = (name: string): HTMLElement => {
  const found = [...document.querySelectorAll<HTMLElement>("button, a")].find(
    (element) =>
      element.getAttribute("aria-label") === name ||
      element.textContent?.trim() === name,
  );
  if (!found) {
    throw new Error(`nothing named ${name}`);
  }
  return found;
};

const open = async () => {
  await act(async () => byName("Ask the copilot").click());
};

/** Lets the stream, the re-read and the state updates after them settle. */
const settle = async () => {
  for (let turn = 0; turn < 10; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  actions.listCopilotProposalsAction.mockResolvedValue([]);
  actions.listCopilotThreadsAction.mockResolvedValue([]);
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", "/");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("the empty panel (plan 0.8.1 CP8)", () => {
  test("offers four questions, and pressing one asks it", async () => {
    fetchMock.mockResolvedValue(
      streamOf([
        { kind: "thread", threadId: THREAD, questionMessageId: QUESTION_ID },
        { kind: "done", answerMessageId: null, stopped: false },
      ]),
    );
    actions.readCopilotThreadAction.mockResolvedValue({
      id: THREAD,
      subjectType: null,
      subjectId: null,
      title: "What have people said about onboarding?",
      messages: [],
    });
    await render(AVAILABLE);
    await open();

    const suggestions = panel()?.querySelector(
      '[aria-label="Suggested questions"]',
    );
    expect(suggestions?.querySelectorAll("button")).toHaveLength(4);

    await act(async () =>
      byName("What have people said about onboarding?").click(),
    );
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      question: "What have people said about onboarding?",
    });
  });

  test("offers none with AI off, where a suggestion would only search", async () => {
    await render(AI_OFF);
    await open();
    expect(
      panel()?.querySelector('[aria-label="Suggested questions"]'),
    ).toBeNull();
  });
});

describe("AI off (plan 0.8.1 CP8)", () => {
  test("keeps the passages and the reason after the turn lands", async () => {
    const reason =
      "No AI provider is configured, so these are the passages that match your question.";
    fetchMock.mockResolvedValue(
      streamOf([
        { kind: "thread", threadId: THREAD, questionMessageId: QUESTION_ID },
        {
          kind: "sources",
          sources: [
            {
              entityType: "goal",
              entityId: "00000000-0000-4000-8000-000000000003",
              label: "New accounts reach value in their first week",
            },
          ],
        },
        { kind: "unavailable", reason },
        { kind: "done", answerMessageId: null, stopped: false },
      ]),
    );
    // The inline path with AI off records the question and nothing else.
    actions.readCopilotThreadAction.mockResolvedValue({
      id: THREAD,
      subjectType: null,
      subjectId: null,
      title: "How is onboarding going?",
      messages: [
        {
          id: QUESTION_ID,
          role: "member",
          content: "How is onboarding going?",
          citations: [],
          stopped: false,
          running: false,
          haltedReason: null,
          createdAt: "2026-11-12T10:00:00.000Z",
        },
      ],
    });
    await render(AI_OFF);
    await open();

    const box = panel()?.querySelector("textarea");
    if (!box) {
      throw new Error("no box");
    }
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(box, "How is onboarding going?");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => byName("Send the question").click());
    await settle();

    // The re-read ran, and what it could not return is still on screen.
    expect(actions.readCopilotThreadAction).toHaveBeenCalledWith(THREAD);
    const kept = panel()?.querySelector('[data-testid="copilot-kept"]');
    expect(kept?.textContent).toContain(reason);
    expect(kept?.textContent).toContain(
      "New accounts reach value in their first week",
    );
  });

  test("links whoever can fix it to the page that does", async () => {
    await render({ ...AI_OFF, fixes: ["aiSettings"] });
    await open();
    const link = byName("Open AI settings");
    expect(link.getAttribute("href")).toBe("/admin/ai");
  });

  test("shows no link to a member who cannot open the page", async () => {
    await render(AI_OFF);
    await open();
    expect(() => byName("Open AI settings")).toThrow();
  });

  test("says when a cap lifts", async () => {
    await render({
      ...AVAILABLE,
      available: false,
      reason: "This workspace has reached its AI budget (12 of 10).",
      resetsAt: "2026-12-01T00:00:00.000Z",
    });
    await open();
    expect(panel()?.textContent).toContain(
      "The copilot can answer again on 1 Dec 2026.",
    );
  });
});

/** A member message or an answer, as the thread read returns one. */
const recorded = (
  id: string,
  role: "member" | "assistant",
  content: string,
  createdAt: string,
) => ({
  id,
  role,
  content,
  citations: [],
  stopped: false,
  running: false,
  haltedReason: null,
  createdAt,
});

/** Types into the box and presses Send. */
const ask = async (text: string) => {
  const box = panel()?.querySelector("textarea");
  if (!box) {
    throw new Error("no box");
  }
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => byName("Send the question").click());
};

describe("turns (plan 0.8.1 CP3)", () => {
  test("the answer stays on screen while the recorded one replaces it", async () => {
    fetchMock.mockResolvedValue(
      streamOf([
        { kind: "thread", threadId: THREAD, questionMessageId: QUESTION_ID },
        { kind: "text", text: "Activation is up " },
        { kind: "text", text: "four points." },
        { kind: "done", answerMessageId: "a1", stopped: false },
      ]),
    );
    let land: (value: unknown) => void = () => undefined;
    actions.readCopilotThreadAction.mockReturnValue(
      new Promise((resolve) => {
        land = resolve;
      }),
    );
    await render(AVAILABLE);
    await open();
    await ask("How is activation?");
    await settle();

    // The stream has ended and the re-read has not landed: the words are
    // still there, in the copilot's turn.
    const articles = () => [...(panel()?.querySelectorAll("article") ?? [])];
    expect(articles()).toHaveLength(1);
    expect(articles()[0]?.textContent).toContain(
      "Activation is up four points.",
    );

    await act(async () =>
      land({
        id: THREAD,
        subjectType: null,
        subjectId: null,
        title: "How is activation?",
        messages: [
          recorded(
            QUESTION_ID,
            "member",
            "How is activation?",
            "2026-11-12T10:00:00.000Z",
          ),
          recorded(
            "a1",
            "assistant",
            "Activation is up four points.",
            "2026-11-12T10:00:04.000Z",
          ),
        ],
      }),
    );
    await settle();

    // One turn, the recorded one, and the question drawn once.
    expect(articles()).toHaveLength(1);
    expect(articles()[0]?.getAttribute("aria-busy")).toBeNull();
    expect(articles()[0]?.textContent).toContain(
      "Activation is up four points.",
    );
    expect(panel()?.textContent?.split("How is activation?").length).toBe(2);
  });

  test("a card sits in the turn whose question made it", async () => {
    actions.listCopilotThreadsAction.mockResolvedValue([
      {
        id: THREAD,
        title: "Two requests",
        updatedAt: "2026-11-12T10:01:05.000Z",
      },
    ]);
    actions.readCopilotThreadAction.mockResolvedValue({
      id: THREAD,
      subjectType: null,
      subjectId: null,
      title: "Two requests",
      messages: [
        recorded(
          "q1",
          "member",
          "Create an onboarding objective",
          "2026-11-12T10:00:00.000Z",
        ),
        recorded(
          "a1",
          "assistant",
          "Here is a card for it.",
          "2026-11-12T10:00:05.000Z",
        ),
        recorded(
          "q2",
          "member",
          "What is blocking it?",
          "2026-11-12T10:01:00.000Z",
        ),
        recorded("a2", "assistant", "Nothing yet.", "2026-11-12T10:01:05.000Z"),
      ],
    });
    actions.listCopilotProposalsAction.mockResolvedValue([
      {
        id: "p1",
        action: "goals.create",
        preview: [{ label: "Objective", value: "Onboard in two days" }],
        why: "You asked for one.",
        status: "pending",
        undone: false,
        reversible: true,
        createdAt: "2026-11-12T10:00:02.000Z",
      },
    ]);
    await render(AVAILABLE);
    await open();
    await settle();
    await act(async () => byName("History").click());
    await act(async () => byName("Two requests").click());
    await settle();

    const text = panel()?.textContent ?? "";
    const card = text.indexOf("Onboard in two days");
    expect(card).toBeGreaterThan(
      text.indexOf("Create an onboarding objective"),
    );
    expect(card).toBeLessThan(text.indexOf("What is blocking it?"));
  });

  test("a rejoined run draws one turn", async () => {
    class SilentEventSource {
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }
    vi.stubGlobal("EventSource", SilentEventSource);
    actions.listCopilotThreadsAction.mockResolvedValue([
      {
        id: THREAD,
        title: "Still going",
        updatedAt: "2026-11-12T10:00:00.000Z",
      },
    ]);
    actions.readCopilotThreadAction.mockResolvedValue({
      id: THREAD,
      subjectType: null,
      subjectId: null,
      title: "Still going",
      messages: [
        recorded(
          "q1",
          "member",
          "Which goals are behind?",
          "2026-11-12T10:00:00.000Z",
        ),
        {
          ...recorded("a1", "assistant", "", "2026-11-12T10:00:00.000Z"),
          running: true,
        },
      ],
    });
    await render(AVAILABLE);
    await open();
    await settle();
    await act(async () => byName("History").click());
    await act(async () => byName("Still going").click());
    await settle();

    const articles = panel()?.querySelectorAll("article") ?? [];
    expect(articles).toHaveLength(1);
    expect(articles[0]?.getAttribute("aria-busy")).toBe("true");
  });
});

describe("conversations (plan 0.8.1 CP2)", () => {
  const threadOf = (id: string, title: string) => ({
    id,
    subjectType: null,
    subjectId: null,
    title,
    messages: [
      recorded(`${id}-q`, "member", `${title}?`, "2026-11-12T10:00:00.000Z"),
      recorded(
        `${id}-a`,
        "assistant",
        `About ${title}.`,
        "2026-11-12T10:00:05.000Z",
      ),
    ],
  });

  test("New chat empties the conversation and the next question starts a new one", async () => {
    window.history.replaceState(null, "", `/?copilot=${THREAD}`);
    actions.readCopilotThreadAction.mockResolvedValue(
      threadOf(THREAD, "Onboarding"),
    );
    await render(AVAILABLE);
    await settle();
    // The address opened the panel on its conversation.
    expect(panel()?.textContent).toContain("About Onboarding.");

    await act(async () => byName("New chat").click());
    await settle();
    expect(panel()?.querySelectorAll("article")).toHaveLength(0);
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
    expect(window.location.search).not.toContain("copilot=");

    fetchMock.mockResolvedValue(
      streamOf([
        {
          kind: "thread",
          threadId: "00000000-0000-4000-8000-000000000009",
          questionMessageId: QUESTION_ID,
        },
        { kind: "done", answerMessageId: null, stopped: false },
      ]),
    );
    actions.readCopilotThreadAction.mockResolvedValue(
      threadOf("00000000-0000-4000-8000-000000000009", "Blockers"),
    );
    await ask("What is blocking us?");
    await settle();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      question: "What is blocking us?",
    });
    expect(window.location.search).toContain(
      "copilot=00000000-0000-4000-8000-000000000009",
    );
  });

  test("History opens an older conversation and puts it in the address", async () => {
    actions.listCopilotThreadsAction.mockResolvedValue([
      { id: "t2", title: "Newer", updatedAt: new Date().toISOString() },
      { id: "t1", title: "Older", updatedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    actions.readCopilotThreadAction.mockResolvedValue(threadOf("t1", "Older"));
    await render(AVAILABLE);
    await open();
    await act(async () => byName("History").click());
    await settle();
    expect(panel()?.textContent).toContain("Today");
    expect(panel()?.textContent).toContain("Earlier");

    await act(async () => byName("Older").click());
    await settle();
    expect(actions.readCopilotThreadAction).toHaveBeenCalledWith("t1");
    expect(panel()?.textContent).toContain("About Older.");
    expect(window.location.search).toContain("copilot=t1");
  });

  test("deleting asks first, then takes it out of History", async () => {
    actions.listCopilotThreadsAction.mockResolvedValue([
      { id: "t1", title: "Older", updatedAt: "2026-01-01T00:00:00.000Z" },
    ]);
    actions.deleteCopilotThreadAction.mockResolvedValue({ error: null });
    await render(AVAILABLE);
    await open();
    await act(async () => byName("History").click());
    await settle();

    await act(async () => byName("Delete Older").click());
    expect(actions.deleteCopilotThreadAction).not.toHaveBeenCalled();
    expect(panel()?.textContent).toContain("It cannot be brought back.");

    actions.listCopilotThreadsAction.mockResolvedValue([]);
    await act(async () => byName("Delete").click());
    await settle();
    expect(actions.deleteCopilotThreadAction).toHaveBeenCalledWith("t1");
    expect(panel()?.textContent).toContain("No conversations yet.");
  });

  test("an address naming a conversation that is not there says so", async () => {
    window.history.replaceState(null, "", `/?copilot=${THREAD}`);
    actions.readCopilotThreadAction.mockRejectedValue(new Error("not found"));
    await render(AVAILABLE);
    await settle();
    expect(panel()?.textContent).toContain(
      "That conversation is not there any more.",
    );
    expect(window.location.search).not.toContain("copilot=");
  });
});

describe("the frame and the keyboard (plan 0.8.1 CP1)", () => {
  const pressEscape = async () => {
    await act(async () => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await settle();
  };

  test("Escape with nothing typed closes it, and focus goes back to Ask", async () => {
    await render(AVAILABLE);
    await open();
    await settle();
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
    await pressEscape();
    expect(panel()).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Ask the copilot",
    );
  });

  test("Escape with something typed stays, because it is the box's", async () => {
    await render(AVAILABLE);
    await open();
    await settle();
    const box = panel()?.querySelector("textarea");
    if (!box) {
      throw new Error("no box");
    }
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(box, "Half a question");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await pressEscape();
    expect(panel()).not.toBeNull();
  });

  test("the close button gives focus back to Ask", async () => {
    await render(AVAILABLE);
    await open();
    await settle();
    await act(async () => byName("Close the copilot").click());
    await settle();
    expect(panel()).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Ask the copilot",
    );
  });

  test("Expand widens it, and the browser remembers", async () => {
    window.localStorage.clear();
    await render(AVAILABLE);
    await open();
    await settle();
    expect(panel()?.className).toContain("md:max-w-lg");
    await act(async () => byName("Expand the copilot").click());
    expect(panel()?.className).toContain("md:max-w-3xl");

    await act(async () => byName("Close the copilot").click());
    await settle();
    await open();
    await settle();
    expect(panel()?.className).toContain("md:max-w-3xl");
    expect(byName("Expand the copilot").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  test("a finished answer is announced once, and focus stays in the box", async () => {
    fetchMock.mockResolvedValue(
      streamOf([
        { kind: "thread", threadId: THREAD, questionMessageId: QUESTION_ID },
        { kind: "text", text: "Activation is up." },
        { kind: "done", answerMessageId: "a1", stopped: false },
      ]),
    );
    actions.readCopilotThreadAction.mockResolvedValue({
      id: THREAD,
      subjectType: null,
      subjectId: null,
      title: "How is activation?",
      messages: [
        recorded(
          QUESTION_ID,
          "member",
          "How is activation?",
          "2026-11-12T10:00:00.000Z",
        ),
        recorded(
          "a1",
          "assistant",
          "Activation is up.",
          "2026-11-12T10:00:04.000Z",
        ),
      ],
    });
    await render(AVAILABLE);
    await open();
    await settle();
    await ask("How is activation?");
    await settle();

    const statuses = [...(panel()?.querySelectorAll('[role="status"]') ?? [])];
    expect(statuses.map((status) => status.textContent)).toContain(
      "Answer ready",
    );
    // The conversation itself is a log that says nothing as it grows.
    const log = panel()?.querySelector('[role="log"]');
    expect(log?.getAttribute("aria-live")).toBe("off");
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
  });
});

describe("the composer (plan 0.8.1 CP6)", () => {
  const type = async (text: string) => {
    const box = panel()?.querySelector("textarea");
    if (!box) {
      throw new Error("no box");
    }
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(box, text);
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return box;
  };

  test("Enter that confirms an input method's word sends nothing", async () => {
    await render(AVAILABLE);
    await open();
    const box = await type("こんにちは");
    await act(async () => {
      box.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          isComposing: true,
        }),
      );
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(box.value).toBe("こんにちは");
  });

  test("the next question can be typed while an answer arrives, and is kept", async () => {
    // A stream that never ends, so the answer is still arriving.
    fetchMock.mockResolvedValue(
      new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    // No streaming provider, so there is nothing to stop and Send stays.
    await render({ ...AVAILABLE, streaming: false });
    await open();
    await ask("First question");
    await settle();

    const box = await type("Second question");
    expect(box.disabled).toBe(false);
    expect(box.value).toBe("Second question");
    const send = byName("Send the question") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("Send becomes Stop in the same place while an answer can be stopped", async () => {
    fetchMock.mockResolvedValue(
      new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    await render(AVAILABLE);
    await open();
    await ask("First question");
    await settle();
    expect(() => byName("Send the question")).toThrow();
    expect(byName("Stop the answer")).toBeDefined();
  });

  test("Stop tells a background run to stop, then lets go of the request", async () => {
    const encoder = new TextEncoder();
    let aborted = false;
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      init.signal?.addEventListener("abort", () => {
        aborted = true;
      });
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `event: thread\ndata: ${JSON.stringify({
                  kind: "thread",
                  threadId: THREAD,
                  questionMessageId: QUESTION_ID,
                  answerMessageId: "00000000-0000-4000-8000-0000000000aa",
                })}\n\n`,
              ),
            );
            init.signal?.addEventListener("abort", () =>
              controller.error(new DOMException("aborted", "AbortError")),
            );
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    });
    actions.readCopilotThreadAction.mockResolvedValue({
      id: THREAD,
      subjectType: null,
      subjectId: null,
      title: "Long one",
      messages: [],
    });
    await render(AVAILABLE);
    await open();
    await ask("A long question");
    await settle();

    await act(async () => byName("Stop the answer").click());
    await settle();
    expect(actions.stopCopilotRunAction).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-0000000000aa",
    );
    expect(aborted).toBe(true);
  });

  test("a refused send puts the question back, with the reason under it", async () => {
    fetchMock.mockResolvedValue(new Response("Bad request", { status: 400 }));
    // In a conversation already open, which is where it went missing before.
    window.history.replaceState(null, "", `/?copilot=${THREAD}`);
    actions.readCopilotThreadAction.mockResolvedValue({
      id: THREAD,
      subjectType: null,
      subjectId: null,
      title: "Open",
      messages: [
        recorded(QUESTION_ID, "member", "Earlier", "2026-11-12T10:00:00.000Z"),
      ],
    });
    await render(AVAILABLE);
    await settle();
    await ask("A question the server refuses");
    await settle();

    const box = panel()?.querySelector("textarea");
    expect(box?.value).toBe("A question the server refuses");
    const alert = panel()?.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(
      "The copilot could not be reached. Your question was not saved.",
    );
  });
});

describe("formatted answers (plan 0.8.1 CP4)", () => {
  test("an answer's bold and list are drawn, and no marker shows", async () => {
    window.history.replaceState(null, "", `/?copilot=${THREAD}`);
    actions.readCopilotThreadAction.mockResolvedValue({
      id: THREAD,
      subjectType: null,
      subjectId: null,
      title: "How is it going?",
      messages: [
        recorded(
          "q1",
          "member",
          "How is it going?",
          "2026-11-12T10:00:00.000Z",
        ),
        recorded(
          "a1",
          "assistant",
          "Activation is **on track**.\n\n- Calls\n- Checklist\n- Reviews\n\nSee [the plan](javascript:alert(1)).",
          "2026-11-12T10:00:05.000Z",
        ),
      ],
    });
    await render(AVAILABLE);
    await settle();
    const answer = panel()?.querySelector("article");
    expect(answer?.querySelector("strong")?.textContent).toBe("on track");
    expect(answer?.querySelectorAll("ul > li")).toHaveLength(3);
    expect(answer?.textContent).not.toContain("**");
    // The model's link is text, and nothing in the answer links anywhere.
    expect(answer?.textContent).toContain("[the plan](javascript:alert(1))");
    expect(answer?.querySelector("a")).toBeNull();
  });
});

describe("answer actions and errors (plan 0.8.1 CP7)", () => {
  const openWith = async (
    messages: readonly ReturnType<typeof recorded>[],
    proposals: readonly unknown[] = [],
  ) => {
    window.history.replaceState(null, "", `/?copilot=${THREAD}`);
    actions.readCopilotThreadAction.mockResolvedValue({
      id: THREAD,
      subjectType: null,
      subjectId: null,
      title: "Open",
      messages,
    });
    actions.listCopilotProposalsAction.mockResolvedValue([...proposals]);
    await render(AVAILABLE);
    await settle();
  };

  test("Copy puts the answer on the clipboard and says so", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await openWith([
      recorded(
        "q1",
        "member",
        "How is activation?",
        "2026-11-12T10:00:00.000Z",
      ),
      recorded(
        "a1",
        "assistant",
        "Activation is **up**.",
        "2026-11-12T10:00:05.000Z",
      ),
    ]);
    await act(async () => byName("Copy the answer").click());
    await settle();
    expect(writeText).toHaveBeenCalledWith("Activation is **up**.");
    expect(panel()?.textContent).toContain("Copied");
  });

  test("Retry asks the last question again when its answer stopped", async () => {
    fetchMock.mockResolvedValue(
      streamOf([
        { kind: "thread", threadId: THREAD, questionMessageId: "q2" },
        { kind: "done", answerMessageId: null, stopped: false },
      ]),
    );
    await openWith([
      recorded(
        "q1",
        "member",
        "How is activation?",
        "2026-11-12T10:00:00.000Z",
      ),
      {
        ...recorded(
          "a1",
          "assistant",
          "Activation is",
          "2026-11-12T10:00:05.000Z",
        ),
        stopped: true,
      },
    ]);
    await act(async () => byName("Retry").click());
    await settle();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      question: "How is activation?",
      threadId: THREAD,
    });
  });

  test("offers no Retry on an answer that finished", async () => {
    await openWith([
      recorded(
        "q1",
        "member",
        "How is activation?",
        "2026-11-12T10:00:00.000Z",
      ),
      recorded(
        "a1",
        "assistant",
        "Activation is up.",
        "2026-11-12T10:00:05.000Z",
      ),
    ]);
    expect(() => byName("Retry")).toThrow();
  });

  const card = (over: Record<string, unknown> = {}) => ({
    id: "p1",
    action: "goals.create",
    preview: [{ label: "Objective", value: "Onboard in two days" }],
    why: "You asked for one.",
    status: "pending",
    undone: false,
    reversible: true,
    createdAt: "2026-11-12T10:00:02.000Z",
    href: null,
    ...over,
  });

  test("a refused Apply says why on the card itself", async () => {
    actions.applyCopilotProposalAction.mockResolvedValue({
      error: "You cannot create an objective in this space.",
    });
    await openWith(
      [
        recorded("q1", "member", "Create one", "2026-11-12T10:00:00.000Z"),
        recorded("a1", "assistant", "Here it is.", "2026-11-12T10:00:05.000Z"),
      ],
      [card()],
    );
    await act(async () => byName("Apply").click());
    await settle();
    const region = panel()?.querySelector('[aria-label="Proposed change"]');
    expect(region?.querySelector('[role="alert"]')?.textContent).toBe(
      "You cannot create an objective in this space.",
    );
  });

  test("an applied card links to what it made", async () => {
    await openWith(
      [
        recorded("q1", "member", "Create one", "2026-11-12T10:00:00.000Z"),
        recorded("a1", "assistant", "Here it is.", "2026-11-12T10:00:05.000Z"),
      ],
      [card({ status: "applied", href: "/goals/g1" })],
    );
    const region = panel()?.querySelector('[aria-label="Proposed change"]');
    expect(region?.querySelector("a")?.getAttribute("href")).toBe("/goals/g1");
  });
});

describe("the streaming look (plan 0.8.1 CP9)", () => {
  /** A stream the test feeds frame by frame. */
  const feed = () => {
    const encoder = new TextEncoder();
    let push: (event: Record<string, unknown>) => void = () => undefined;
    let end: () => void = () => undefined;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          push = (event) =>
            controller.enqueue(
              encoder.encode(
                `event: ${String(event.kind)}\ndata: ${JSON.stringify(event)}\n\n`,
              ),
            );
          end = () => controller.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
    return {
      response,
      push: (event: Record<string, unknown>) => push(event),
      end: () => end(),
    };
  };

  test("says it is checking for a change it can make before the card shows", async () => {
    const stream = feed();
    fetchMock.mockResolvedValue(stream.response);
    await render(AVAILABLE);
    await open();
    await ask("Add a task to one of my key results");
    await settle();
    stream.push({
      kind: "thread",
      threadId: THREAD,
      questionMessageId: QUESTION_ID,
    });
    stream.push({ kind: "step", step: "found", count: 2 });
    stream.push({ kind: "step", step: "proposing" });
    // Longer than every step's dwell, so the line has reached the last one.
    for (let wait = 0; wait < 4; wait += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 450));
      });
    }
    const turn = panel()?.querySelector("article");
    expect(turn?.textContent).toContain(
      "Checking whether this is a change I can make…",
    );
    expect(turn?.querySelector('[aria-label="Proposed change"]')).toBeNull();
    stream.end();
    await settle();
  });

  test("folds the steps once words arrive, and ends the words in a caret", async () => {
    const stream = feed();
    fetchMock.mockResolvedValue(stream.response);
    await render(AVAILABLE);
    await open();
    await ask("What have people said about onboarding?");
    await settle();
    stream.push({
      kind: "thread",
      threadId: THREAD,
      questionMessageId: QUESTION_ID,
    });
    stream.push({ kind: "step", step: "found", count: 3 });
    stream.push({ kind: "step", step: "writing" });
    stream.push({ kind: "text", text: "People asked for " });
    await settle();

    const turn = panel()?.querySelector("article");
    const summary = turn?.querySelector("details > summary");
    expect(summary?.textContent).toBe(
      "Searched your workspace, found 3 passages",
    );
    expect(turn?.querySelector("details")?.hasAttribute("open")).toBe(false);
    expect(turn?.querySelector(".copilot-caret")).not.toBeNull();
    stream.end();
    await settle();
  });

  test("moves on from a step no sooner than 400 milliseconds", () => {
    expect(nextShownStep(3, -1, 0)).toBe(0);
    expect(nextShownStep(3, 0, 120)).toBe(0);
    expect(nextShownStep(3, 0, 400)).toBe(1);
    expect(nextShownStep(3, 2, 900)).toBe(2);
    expect(nextShownStep(0, -1, 0)).toBe(-1);
  });
});

describe("a stopped answer (plan 0.8.1 CP9 with W4)", () => {
  test("keeps its words on screen, marked stopped, until the run has recorded them", async () => {
    const encoder = new TextEncoder();
    fetchMock.mockImplementation(
      async (_url: string, init: RequestInit) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const event of [
                {
                  kind: "thread",
                  threadId: THREAD,
                  questionMessageId: QUESTION_ID,
                  answerMessageId: "a1",
                },
                { kind: "text", text: "Activation is up four" },
              ]) {
                controller.enqueue(
                  encoder.encode(
                    `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`,
                  ),
                );
              }
              init.signal?.addEventListener("abort", () =>
                controller.error(new DOMException("aborted", "AbortError")),
              );
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    );
    // The run has been told to stop and has not written its words yet.
    actions.readCopilotThreadAction.mockResolvedValue({
      id: THREAD,
      subjectType: null,
      subjectId: null,
      title: "Activation",
      messages: [
        recorded(
          QUESTION_ID,
          "member",
          "How is activation?",
          "2026-11-12T10:00:00.000Z",
        ),
        {
          ...recorded("a1", "assistant", "", "2026-11-12T10:00:00.000Z"),
          stopped: true,
        },
      ],
    });
    await render(AVAILABLE);
    await open();
    await ask("How is activation?");
    await settle();
    await act(async () => byName("Stop the answer").click());
    await settle();

    const turn = panel()?.querySelector("article");
    expect(turn?.textContent).toContain("Activation is up four");
    expect(turn?.textContent).toContain("Stopped");
  });
});
