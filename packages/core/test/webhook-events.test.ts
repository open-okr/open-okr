import { describe, expect, it } from "vitest";
import { ACTIVITY_PAYLOAD_SCHEMAS } from "../src/activities/catalogue.ts";
import {
  ACTIVITY_EVENT_ROUTES,
  eventFor,
  possibleEvents,
  WEBHOOK_EVENT_GROUPS,
  WEBHOOK_EVENTS,
} from "../src/webhooks/events.ts";

/**
 * The public event catalogue against the activity catalogue
 * (docs/design/outbound-webhooks.md §2, W3).
 *
 * Both directions: an event nothing can fire is a promise to receivers the
 * product never keeps, and a mapped kind the activity catalogue does not
 * register is a mapping that silently never runs.
 */

describe("the webhook event catalogue", () => {
  it("fires every event from at least one registered activity kind", () => {
    const fired = new Set(
      Object.values(ACTIVITY_EVENT_ROUTES).flatMap((route) => route.events),
    );
    for (const event of WEBHOOK_EVENTS) {
      expect(fired.has(event), event).toBe(true);
    }
  });

  it("maps only kinds the activity catalogue registers, each to a known event", () => {
    const registered = new Set(Object.keys(ACTIVITY_PAYLOAD_SCHEMAS));
    for (const [kind, route] of Object.entries(ACTIVITY_EVENT_ROUTES)) {
      expect(registered.has(kind), kind).toBe(true);
      expect(route.events.length, kind).toBeGreaterThan(0);
      for (const event of route.events) {
        expect(WEBHOOK_EVENTS as readonly string[], kind).toContain(event);
      }
    }
  });

  it("lists every event in exactly one group on the screen", () => {
    const grouped = WEBHOOK_EVENT_GROUPS.flatMap((group) => group.events);
    expect([...grouped].sort()).toEqual([...WEBHOOK_EVENTS].sort());
  });

  it("costs an unmapped kind nothing", () => {
    expect(possibleEvents("member.profile_updated")).toEqual([]);
    expect(eventFor("member.profile_updated", {})).toBeNull();
  });

  it("decides from the payload where one kind can mean two things", () => {
    expect(eventFor("task.moved", { status: "done" })).toBe("task.completed");
    expect(eventFor("task.moved", { status: "in_progress" })).toBeNull();
    expect(
      eventFor("task.updated", { fields: ["status"], status: "done" }),
    ).toBe("task.completed");
    expect(eventFor("task.updated", { fields: ["title"] })).toBeNull();
    expect(
      eventFor("initiative.updated", { fields: ["status"], status: "done" }),
    ).toBe("initiative.completed");
    expect(eventFor("initiative.updated", { fields: ["title"] })).toBe(
      "initiative.updated",
    );
    expect(
      eventFor("goal.draft_published", { awaitingApproval: true }),
    ).toBeNull();
    expect(eventFor("goal.draft_published", { awaitingApproval: false })).toBe(
      "objective.published",
    );
    expect(eventFor("cycle.updated", { name: "Q1", fields: ["phase"] })).toBe(
      "cycle.phase_changed",
    );
    expect(
      eventFor("cycle.updated", { name: "Q1", fields: ["name"] }),
    ).toBeNull();
    expect(eventFor("cycle.closing_started", {})).toBe("cycle.phase_changed");
  });
});
