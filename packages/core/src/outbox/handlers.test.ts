import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { EMBED_TOPIC } from "../embeddings/subjects.ts";
import {
  dispatchOutbox,
  OUTBOX_HANDLERS,
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
  const sent: Array<{ to: string; subject: string; text: string }> = [];
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
    // The one topic enqueued through a constant rather than a literal.
    expect(EMBED_TOPIC in OUTBOX_HANDLERS).toBe(true);
  });
});
