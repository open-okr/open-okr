import { describe, expect, it } from "vitest";
import {
  boardPresenceChannel,
  PRESENCE_EXPIRY_MS,
  PresenceRoster,
  type PresenceSignal,
  presenceEvent,
  readPresenceSignal,
} from "../src/tasks/presence.ts";

/**
 * Who else has a board open (UIUX-PLAN §3 "Presence", completeness review
 * M-02).
 *
 * Pure, so no database and no realtime driver. Who may be named is proved in
 * `board-scopes.test.ts`; the stream that carries these signals is proved in
 * `apps/web/test/board-live.test.tsx`.
 */

const ADA = "11111111-1111-4111-8111-111111111111";
const BO = "22222222-2222-4222-8222-222222222222";
const CY = "33333333-3333-4333-8333-333333333333";
const TAB_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TAB_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TAB_3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const here = (memberId: string, viewerId: string): PresenceSignal => ({
  kind: "here",
  memberId,
  viewerId,
  join: false,
});
const left = (memberId: string, viewerId: string): PresenceSignal => ({
  kind: "left",
  memberId,
  viewerId,
  join: false,
});

describe("the channel", () => {
  it("is one per board, so a key result's board is not a space's", () => {
    const workspace = "w";
    expect(
      boardPresenceChannel(workspace, { kind: "space", id: "s" }),
    ).not.toBe(
      boardPresenceChannel(workspace, { kind: "key_result", id: "s" }),
    );
  });

  it("carries identifiers and nothing else", () => {
    const event = presenceEvent({ ...here(ADA, TAB_1), join: true });
    expect(event).toEqual({
      name: "presence.here",
      data: { memberId: ADA, viewerId: TAB_1, join: true },
    });
    expect(readPresenceSignal(event.name, event.data)).toEqual({
      kind: "here",
      memberId: ADA,
      viewerId: TAB_1,
      join: true,
    });
  });

  it("ignores anything that is not a well-formed signal", () => {
    expect(readPresenceSignal("board.changed", { memberId: ADA })).toBeNull();
    expect(readPresenceSignal("presence.here", null)).toBeNull();
    expect(
      readPresenceSignal("presence.here", { memberId: "Ada", viewerId: TAB_1 }),
    ).toBeNull();
    expect(
      readPresenceSignal("presence.left", { memberId: ADA, viewerId: 7 }),
    ).toBeNull();
  });
});

describe("the roster", () => {
  it("names everybody else, in the order they arrived, and never the viewer", () => {
    const roster = new PresenceRoster();
    expect(roster.note(here(BO, TAB_2), 0)).toBe(true);
    expect(roster.note(here(ADA, TAB_1), 0)).toBe(true);
    expect(roster.note(here(CY, TAB_3), 0)).toBe(true);
    expect(roster.others(ADA)).toEqual([BO, CY]);
  });

  it("counts a person with two tabs once, and keeps them until both close", () => {
    const roster = new PresenceRoster();
    roster.note(here(BO, TAB_1), 0);
    expect(roster.note(here(BO, TAB_2), 0)).toBe(false);
    expect(roster.others(ADA)).toEqual([BO]);

    expect(roster.note(left(BO, TAB_1), 1)).toBe(false);
    expect(roster.others(ADA)).toEqual([BO]);
    expect(roster.note(left(BO, TAB_2), 2)).toBe(true);
    expect(roster.others(ADA)).toEqual([]);
  });

  it("reports a heartbeat as no change, so nothing is re-read for it", () => {
    const roster = new PresenceRoster();
    roster.note(here(BO, TAB_1), 0);
    expect(roster.note(here(BO, TAB_1), 20_000)).toBe(false);
  });

  it("drops a board whose heartbeats stopped, and keeps one that is still beating", () => {
    const roster = new PresenceRoster();
    roster.note(here(BO, TAB_1), 0);
    roster.note(here(CY, TAB_2), 0);
    roster.note(here(CY, TAB_2), 30_000);

    expect(roster.sweep(PRESENCE_EXPIRY_MS)).toBe(false);
    expect(roster.sweep(PRESENCE_EXPIRY_MS + 1)).toBe(true);
    expect(roster.others(ADA)).toEqual([CY]);
  });

  it("does not move somebody to the end when they beat again", () => {
    const roster = new PresenceRoster();
    roster.note(here(BO, TAB_1), 0);
    roster.note(here(CY, TAB_2), 0);
    roster.note(here(BO, TAB_1), 10);
    expect(roster.others(ADA)).toEqual([BO, CY]);
  });
});
