import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { CHANNEL_MESSAGE_TOPIC } from "../actions/channels.ts";
import { agentRunChangedEvent } from "../agents/live.ts";
import { AGENT_RUN_STEP_TOPIC } from "../agents/run-steps.ts";
import { VERIFY_EMAIL_TOPIC } from "../auth/verification-links.ts";
import { EMBED_TOPIC } from "../embeddings/subjects.ts";
import {
  dispatchOutbox,
  OUTBOX_HANDLERS,
  OUTBOX_REDACT_ON_DELIVERY,
  type OutboxDelivery,
  type OutboxHandlerDeps,
} from "./handlers.ts";

/**
 * The outbox dispatch table (P5-T01a).
 *
 * The acceptance criterion this file holds: every topic the product enqueues
 * has a handler, a topic nobody handles fails permanently rather than retrying
 * ten times, and a handler whose dependency is missing skips rather than fails.
 * None of it needs a database, which is the point of taking dependencies as
 * plain functions.
 */

const delivery = (
  topic: string,
  payload: Record<string, unknown> = {},
): OutboxDelivery => ({
  topic,
  payload,
  idempotencyKey: `${topic}:1`,
  attempts: 1,
});

/** A pool no test may touch: reaching it means a handler took the wrong path. */
const noPool = new Proxy({} as Pool, {
  get() {
    throw new Error("this delivery should not have reached the database");
  },
});

const recorder = () => {
  const published: Array<[string, string, Record<string, unknown>]> = [];
  const sent: Array<{
    to: string;
    subject: string;
    text: string;
    html?: string;
  }> = [];
  const skipped: Array<[string, string]> = [];
  const deps: OutboxHandlerDeps = {
    pool: noPool,
    publish: async (channel, event, data) => {
      published.push([channel, event, data]);
    },
    sendMail: async (message) => {
      sent.push({ ...message });
    },
    baseUrl: "https://okr.example.com/",
    onSkipped: (d, reason) => skipped.push([d.topic, reason]),
  };
  return { published, sent, skipped, deps };
};

describe("dispatchOutbox", () => {
  it("refuses a topic nothing handles, permanently", async () => {
    const { deps } = recorder();
    await expect(
      dispatchOutbox(delivery("something.nobody.consumes"), deps),
    ).rejects.toMatchObject({
      name: "PermanentDispatchError",
    });
  });

  it("names the topic in the refusal, so the log says which producer ran ahead", async () => {
    const { deps } = recorder();
    await expect(
      dispatchOutbox(delivery("goal.checkedIn"), deps),
    ).rejects.toThrow(/goal\.checkedIn/);
  });
});

describe("realtime topics", () => {
  it("publishes on the channel the enqueuing action put on the payload", async () => {
    const { published, deps } = recorder();
    await dispatchOutbox(
      delivery("session.stageChanged", {
        channel: "workspace:w1:session:s1",
        sessionId: "s1",
        stage: "scoring",
      }),
      deps,
    );
    expect(published).toEqual([
      [
        "workspace:w1:session:s1",
        "session.stageChanged",
        { sessionId: "s1", stage: "scoring" },
      ],
    ]);
  });

  it("publishes an agent run's change on the workspace's run channel (A11)", async () => {
    const { published, deps } = recorder();
    const message = agentRunChangedEvent({
      workspaceId: "w1",
      runId: "r1",
      status: "running",
      logLength: 2,
    });
    await dispatchOutbox(delivery(message.topic, { ...message.payload }), deps);
    expect(published).toEqual([
      [
        "workspace:w1:agent-runs",
        "agentRun.changed",
        { workspaceId: "w1", runId: "r1", version: 2 },
      ],
    ]);
  });

  it("fails permanently when the row carries no channel", async () => {
    const { deps } = recorder();
    await expect(
      dispatchOutbox(delivery("session.micPassed", { sessionId: "s1" }), deps),
    ).rejects.toMatchObject({ name: "PermanentDispatchError" });
  });

  it("skips rather than fails when the deployment has no realtime", async () => {
    const { skipped, deps } = recorder();
    const { publish: _publish, ...withoutRealtime } = deps;
    await dispatchOutbox(
      delivery("session.scoresRevealed", { channel: "c" }),
      withoutRealtime,
    );
    expect(skipped).toEqual([
      ["session.scoresRevealed", "no realtime transport is configured"],
    ]);
  });
});

describe("invitation email", () => {
  it("sends the join link, with exactly one slash between origin and path", async () => {
    const { sent, deps } = recorder();
    await dispatchOutbox(
      delivery("invitation.email", { to: "sam@example.com", token: "tok-1" }),
      deps,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("sam@example.com");
    expect(sent[0]?.text).toContain("https://okr.example.com/join/tok-1");
  });

  it("names the instance it invites somebody to (M-33)", async () => {
    const { sent, deps } = recorder();
    await dispatchOutbox(
      delivery("invitation.email", { to: "sam@example.com", token: "tok-1" }),
      { ...deps, instanceName: "OKR Goal" },
    );
    expect(sent[0]?.subject).toBe("You have been invited to OKR Goal");
    expect(sent[0]?.text).toContain("Join a workspace on OKR Goal");
    expect(sent[0]?.html).toContain("Join a workspace on OKR Goal");
    expect(JSON.stringify(sent[0])).not.toContain("OpenOKR");
  });

  it("says OpenOKR when the host gives no name", async () => {
    const { sent, deps } = recorder();
    await dispatchOutbox(
      delivery("invitation.email", { to: "sam@example.com", token: "tok-1" }),
      deps,
    );
    expect(sent[0]?.subject).toBe("You have been invited to OpenOKR");
    expect(sent[0]?.text).toContain("Join a workspace on OpenOKR");
  });

  it("fails permanently when the row has no token, because no retry will add one", async () => {
    const { deps } = recorder();
    await expect(
      dispatchOutbox(
        delivery("invitation.email", { to: "sam@example.com" }),
        deps,
      ),
    ).rejects.toMatchObject({ name: "PermanentDispatchError" });
  });

  it("skips when no mail is configured, so an instance without SMTP collects no dead letters", async () => {
    const { skipped, sent, deps } = recorder();
    const { sendMail: _sendMail, ...withoutMail } = deps;
    await dispatchOutbox(
      delivery("invitation.email", { to: "sam@example.com", token: "tok-1" }),
      withoutMail,
    );
    expect(sent).toEqual([]);
    expect(skipped).toEqual([
      ["invitation.email", "no mail transport is configured"],
    ]);
  });
});

/**
 * The link that confirms an address (email-verification.md D5). The checks
 * that read the account need a database and are in
 * `packages/core/test/email-verification.test.ts`; these are the ones that
 * must be decided before anything is read.
 */
describe("a confirmation link", () => {
  const link = (over: Record<string, unknown> = {}) =>
    delivery(VERIFY_EMAIL_TOPIC, {
      userId: "u1",
      to: "amara@example.com",
      url: "https://okr.example.com/api/auth/verify-email?token=t",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      reason: "sign_up",
      ...over,
    });

  it("fails permanently when the row has no link, because no retry will add one", async () => {
    const { deps } = recorder();
    await expect(
      dispatchOutbox(link({ url: undefined }), deps),
    ).rejects.toMatchObject({ name: "PermanentDispatchError" });
  });

  it("skips when no mail is configured, before reading anything", async () => {
    const { skipped, sent, deps } = recorder();
    const { sendMail: _sendMail, ...withoutMail } = deps;
    await dispatchOutbox(link(), withoutMail);
    expect(sent).toEqual([]);
    expect(skipped).toEqual([
      [VERIFY_EMAIL_TOPIC, "no mail transport is configured"],
    ]);
  });

  it("skips a link that has expired, because nobody could use it", async () => {
    const { skipped, sent, deps } = recorder();
    await dispatchOutbox(
      link({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
      deps,
    );
    expect(sent).toEqual([]);
    expect(skipped).toEqual([[VERIFY_EMAIL_TOPIC, "the link has expired"]]);
  });

  it("loses the address and the link once delivered", () => {
    expect(OUTBOX_REDACT_ON_DELIVERY[VERIFY_EMAIL_TOPIC]).toEqual([
      "to",
      "url",
    ]);
  });
});

describe("topics with no consumer yet", () => {
  it("acknowledges a rename rather than dead-lettering every one of them", async () => {
    const { skipped, deps } = recorder();
    await dispatchOutbox(
      delivery("workspace.renamed", { workspaceId: "w1" }),
      deps,
    );
    expect(skipped).toEqual([
      ["workspace.renamed", "no consumer for this topic yet"],
    ]);
  });
});

describe("embedding", () => {
  it("fails permanently on a payload that is not an embed job", async () => {
    const { deps } = recorder();
    await expect(
      dispatchOutbox(delivery(EMBED_TOPIC, { workspaceId: "w1" }), deps),
    ).rejects.toMatchObject({ name: "PermanentDispatchError" });
  });
});

describe("agent run steps (M-11)", () => {
  const step = (payload: Record<string, unknown>) =>
    delivery(AGENT_RUN_STEP_TOPIC, payload);
  const job = { workspaceId: "w1", runId: "r1", taskIndex: 2 };

  it("hands the step to the host's runner", async () => {
    const { skipped, deps } = recorder();
    const taken: unknown[] = [];
    await dispatchOutbox(step(job), {
      ...deps,
      continueAgentRun: async (given) => {
        taken.push(given);
        return { kind: "stepped" };
      },
    });
    expect(taken).toEqual([job]);
    expect(skipped).toEqual([]);
  });

  it("reports a step the runner skipped, rather than failing it", async () => {
    const { skipped, deps } = recorder();
    await dispatchOutbox(step(job), {
      ...deps,
      continueAgentRun: async () => ({
        kind: "skipped",
        reason: "the run is cancelled",
      }),
    });
    expect(skipped).toEqual([[AGENT_RUN_STEP_TOPIC, "the run is cancelled"]]);
  });

  it("skips when this process runs no agents", async () => {
    const { skipped, deps } = recorder();
    await dispatchOutbox(step(job), deps);
    expect(skipped).toEqual([
      [AGENT_RUN_STEP_TOPIC, "this process runs no agents"],
    ]);
  });

  it("fails permanently on a row that names no task index", async () => {
    const { deps } = recorder();
    await expect(
      dispatchOutbox(step({ workspaceId: "w1", runId: "r1" }), {
        ...deps,
        continueAgentRun: async () => ({ kind: "stepped" }),
      }),
    ).rejects.toMatchObject({ name: "PermanentDispatchError" });
  });
});

describe("the table against the code that enqueues", () => {
  /**
   * The gate that stops a producer shipping ahead of its consumer.
   *
   * Reads the action sources rather than trusting a list, because a list is the
   * thing somebody forgets to update. A new `topic: "..."` with no handler
   * fails here, at the keystroke, instead of dead-lettering in production.
   */
  it("has a handler for every topic the actions enqueue", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    // fileURLToPath, not URL.pathname: on Windows the latter yields a leading
    // slash before the drive letter and every read fails.
    const roots = [
      fileURLToPath(new URL("../actions/", import.meta.url)),
      fileURLToPath(new URL("../operations/", import.meta.url)),
    ];

    const found = new Set<string>();
    for (const root of roots) {
      for (const name of await readdir(root)) {
        if (!name.endsWith(".ts") || name.endsWith(".test.ts")) {
          continue;
        }
        const source = await readFile(join(root, name), "utf8");
        for (const match of source.matchAll(/\btopic:\s*"([^"]+)"/g)) {
          const topic = match[1];
          if (topic) {
            found.add(topic);
          }
        }
      }
    }

    // A guard on the guard: if this ever reads zero topics, the regex has
    // stopped matching and the test would pass by finding nothing.
    expect(found.size).toBeGreaterThanOrEqual(5);
    expect([...found].filter((topic) => !(topic in OUTBOX_HANDLERS))).toEqual(
      [],
    );
    // The topics enqueued through a constant rather than a literal, which the
    // scan above cannot see.
    expect(EMBED_TOPIC in OUTBOX_HANDLERS).toBe(true);
    expect(CHANNEL_MESSAGE_TOPIC in OUTBOX_HANDLERS).toBe(true);
    // Enqueued by `agents.startRun` and by the run executor in
    // `packages/agents`, which this scan does not read (M-11). The executor
    // wrote it from P2-T17 with nothing to read it.
    expect(AGENT_RUN_STEP_TOPIC in OUTBOX_HANDLERS).toBe(true);
    // Queued by the confirmation callback in `createAuth` (S3).
    expect(VERIFY_EMAIL_TOPIC in OUTBOX_HANDLERS).toBe(true);
  });
});
