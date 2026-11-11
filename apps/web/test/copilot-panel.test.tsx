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
  listCopilotProposalsAction: vi.fn(async () => []),
  listCopilotThreadsAction: vi.fn(async () => []),
  readCopilotThreadAction: vi.fn(),
  undoCopilotProposalAction: vi.fn(),
}));
vi.mock("../app/copilot/actions", () => actions);

const { CopilotPanel } = await import("../app/copilot/copilot-panel");

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
