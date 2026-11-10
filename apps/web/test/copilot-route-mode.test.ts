import { resetEnvCache } from "@openokr/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Whether the copilot answers in the background or inline (plan 0.8.0 H10d,
 * docs/design/worker-deployment.md §1.3).
 *
 * The background run needs something draining the outbox. With the relay on
 * the worker (`elsewhere`), the worker drafts the answer and publishes it
 * over the realtime channel this route listens on, so the reader can still
 * close the tab and come back. Only `off` means nothing may be draining, and
 * only `off` answers inline.
 */

const callAction = vi.fn();
const streamAnswer = vi.fn();

vi.mock("@openokr/core", () => ({
  callAction: (...args: unknown[]) => callAction(...args),
  copilotThreadChannel: (workspaceId: string, threadId: string) =>
    `copilot:${workspaceId}:${threadId}`,
  streamAnswer: (...args: unknown[]) => streamAnswer(...args),
}));
vi.mock("../lib/workspace", () => ({
  requireWorkspace: async () => ({
    session: { user: { id: "user-1" } },
    workspace: { workspaceId: "workspace-1" },
  }),
}));
vi.mock("../lib/auth", () => ({ getPool: () => ({}) }));
vi.mock("../lib/drafter", () => ({
  resolveDrafterFor: async () => ({ off: "no_provider" }),
}));
vi.mock("../lib/realtime", () => ({
  getRealtime: () => ({
    subscribe: async () => ({ unsubscribe: async () => undefined }),
  }),
}));

const { POST } = await import("../app/api/copilot/route");

const ask = () =>
  POST(
    new Request("http://localhost/api/copilot", {
      method: "POST",
      body: JSON.stringify({ question: "What is at risk this quarter?" }),
    }) as never,
  );

const original = process.env.OPENOKR_RELAY;

beforeEach(() => {
  process.env.DATABASE_URL ??=
    "postgres://openokr:secret@localhost:5432/openokr";
  callAction.mockReset().mockResolvedValue({
    threadId: "thread-1",
    messageId: "question-1",
    answerMessageId: "answer-1",
  });
  streamAnswer.mockReset().mockImplementation(async function* () {
    yield { kind: "done", answerMessageId: null, stopped: false };
  });
});

afterEach(() => {
  process.env.OPENOKR_RELAY = original;
  resetEnvCache();
});

const withRelay = (value: string) => {
  process.env.OPENOKR_RELAY = value;
  resetEnvCache();
};

describe("where the copilot's answer is drafted", () => {
  it.each(["on", "elsewhere"])(
    "with the relay %s, enqueues a background run",
    async (value) => {
      withRelay(value);
      const response = await ask();
      expect(response.status).toBe(200);
      expect(callAction).toHaveBeenCalledWith(
        expect.anything(),
        "copilot.ask",
        expect.objectContaining({ background: true }),
      );
      expect(streamAnswer).not.toHaveBeenCalled();
      await response.body?.cancel();
    },
  );

  it("with the relay off, answers inline, as before", async () => {
    withRelay("off");
    const response = await ask();
    expect(response.status).toBe(200);
    await response.text();
    expect(streamAnswer).toHaveBeenCalledTimes(1);
    expect(callAction).not.toHaveBeenCalled();
  });
});
