import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Realtime, RealtimeEvent, Subscription } from "@openokr/adapters";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { joinBoardPresence } from "../lib/board-presence.ts";

/**
 * The server's half of the board's presence and its stream (completeness
 * review M-02).
 *
 * Two boards open on one channel, through an in-memory stand-in for the
 * Realtime port, with a clock the test turns by hand. The Postgres driver
 * underneath is proved in `packages/adapters`; who may be named, against a real
 * database, in `packages/core/test/board-scopes.test.ts`; what the browser
 * draws in `board-live.test.tsx`.
 */

/** The Realtime port, in memory: every subscriber on a channel hears a publish. */
class MemoryRealtime implements Realtime {
  readonly #channels = new Map<string, Set<(event: RealtimeEvent) => void>>();
  published = 0;
  failing = false;

  async publish(channel: string, event: RealtimeEvent): Promise<void> {
    this.published += 1;
    for (const handler of [...(this.#channels.get(channel) ?? [])]) {
      handler(event);
    }
  }

  async subscribe(
    channel: string,
    handler: (event: RealtimeEvent) => void,
  ): Promise<Subscription> {
    if (this.failing) {
      throw new Error("the listen connection is down");
    }
    const set = this.#channels.get(channel) ?? new Set();
    set.add(handler);
    this.#channels.set(channel, set);
    return {
      unsubscribe: async () => {
        set.delete(handler);
      },
    };
  }

  async stop(): Promise<void> {}
}

const CHANNEL = "workspace:w:presence:board:space:s";
const ADA = "11111111-1111-4111-8111-111111111111";
const BO = "22222222-2222-4222-8222-222222222222";
const TAB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TAB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TAB_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let clock = 0;
const now = () => clock;

/** Lets the fire-and-forget publishes a handler starts finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  clock = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("presence on one board", () => {
  test("a board that opens learns at once who is already there, and they learn of it", async () => {
    const realtime = new MemoryRealtime();
    const seenByAda: (readonly string[])[] = [];
    const seenByBo: (readonly string[])[] = [];

    const ada = await joinBoardPresence({
      realtime,
      channel: CHANNEL,
      memberId: ADA,
      viewerId: TAB_A,
      now,
      onChange: (ids) => seenByAda.push(ids),
    });
    expect(seenByAda).toEqual([]);

    const bo = await joinBoardPresence({
      realtime,
      channel: CHANNEL,
      memberId: BO,
      viewerId: TAB_B,
      now,
      onChange: (ids) => seenByBo.push(ids),
    });
    await settle();

    // Ada heard Bo join; Bo heard Ada answer, without waiting a heartbeat.
    expect(seenByAda.at(-1)).toEqual([BO]);
    expect(seenByBo.at(-1)).toEqual([ADA]);

    await bo.close();
    expect(seenByAda.at(-1)).toEqual([]);
    await ada.close();
  });

  test("never lists the viewer, even from a second tab of their own", async () => {
    const realtime = new MemoryRealtime();
    const seen: (readonly string[])[] = [];
    const first = await joinBoardPresence({
      realtime,
      channel: CHANNEL,
      memberId: ADA,
      viewerId: TAB_A,
      now,
      onChange: (ids) => seen.push(ids),
    });
    const second = await joinBoardPresence({
      realtime,
      channel: CHANNEL,
      memberId: ADA,
      viewerId: TAB_C,
      now,
      onChange: () => undefined,
    });
    await settle();
    expect(seen).toEqual([]);
    await second.close();
    await first.close();
  });

  test("drops a board whose heartbeats stop, and keeps one that beats", async () => {
    vi.useFakeTimers();
    const realtime = new MemoryRealtime();
    const seen: (readonly string[])[] = [];
    const ada = await joinBoardPresence({
      realtime,
      channel: CHANNEL,
      memberId: ADA,
      viewerId: TAB_A,
      now,
      heartbeatMs: 20_000,
      onChange: (ids) => seen.push(ids),
    });
    // A board on a process that then died: it said it was here, once, and
    // never said it left.
    await realtime.publish(CHANNEL, {
      name: "presence.here",
      data: { memberId: BO, viewerId: TAB_B },
    });
    expect(seen.at(-1)).toEqual([BO]);

    clock = 40_000;
    await vi.advanceTimersByTimeAsync(40_000);
    expect(seen.at(-1)).toEqual([BO]);

    clock = 60_000;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(seen.at(-1)).toEqual([]);
    await ada.close();
  });

  test("ignores an event on the channel that is not a presence signal", async () => {
    const realtime = new MemoryRealtime();
    const seen: (readonly string[])[] = [];
    const ada = await joinBoardPresence({
      realtime,
      channel: CHANNEL,
      memberId: ADA,
      viewerId: TAB_A,
      now,
      onChange: (ids) => seen.push(ids),
    });
    await realtime.publish(CHANNEL, {
      name: "presence.here",
      data: { memberId: "<script>", viewerId: TAB_B },
    });
    await realtime.publish(CHANNEL, { name: "board.changed", data: {} });
    expect(seen).toEqual([]);
    await ada.close();
  });

  test("refuses to open when the port cannot subscribe, so the route can say so", async () => {
    const realtime = new MemoryRealtime();
    realtime.failing = true;
    await expect(
      joinBoardPresence({
        realtime,
        channel: CHANNEL,
        memberId: ADA,
        onChange: () => undefined,
      }),
    ).rejects.toThrow(/listen connection/);
    expect(realtime.published).toBe(0);
  });

  test("closing twice says it left once", async () => {
    const realtime = new MemoryRealtime();
    const ada = await joinBoardPresence({
      realtime,
      channel: CHANNEL,
      memberId: ADA,
      viewerId: TAB_A,
      now,
      onChange: () => undefined,
    });
    const before = realtime.published;
    await ada.close();
    await ada.close();
    expect(realtime.published).toBe(before + 1);
  });
});

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

describe("the board's stream", () => {
  const route = at("../app/api/board/live/route.ts");

  test("opens for one scope at a time, and only after the board read allows it", () => {
    expect(route).toContain('["keyResult", "key_result"]');
    expect(route).toContain('"tasks.board"');
    expect(route).toContain("status: 400");
    expect(route).toContain("status: 401");
    expect(route).toContain("status: 404");
  });

  test("says realtime is unavailable rather than holding a dead stream open", () => {
    expect(route).toContain("status: 503");
  });

  test("sends a bare ping for a change, and names only who this viewer may see", () => {
    expect(route).toContain('"event: board.changed\\ndata: {}\\n\\n"');
    expect(route).toContain("boardReaders(pool");
    expect(route).toContain("event: presence");
  });

  test("says it has left when the reader goes", () => {
    expect(route).toContain('addEventListener("abort"');
    expect(route).toContain("presence?.close()");
  });

  test("replaces the per-space route, which could not serve the other two boards", () => {
    expect(() => at("../app/api/board/[spaceId]/live/route.ts")).toThrow();
  });
});

describe("the doors to the scoped boards", () => {
  test("the initiative page and each key result on a goal link to their board", () => {
    // Matched as the source spells it, placeholder and all.
    expect(at("../app/initiatives/[id]/page.tsx")).toMatch(
      /\/board\?initiative=\$\{initiative\.id\}/,
    );
    expect(at("../app/goals/[id]/page.tsx")).toMatch(
      /\/board\?keyResult=\$\{keyResult\.id\}/,
    );
  });
});
