import { describe, expect, it } from "vitest";
import { seesCycle } from "../lib/cycle-visibility.ts";

/**
 * Who sees Cycle in the sidebar, and the phase strip above every screen
 * (navigation-five-areas.md, OKRGoal UX review N3): the people who run the
 * cycle, not every member. The route itself stays open at view.
 */
describe("who sees Cycle", () => {
  it("is a workspace administrator", () => {
    expect(seesCycle({ administers: true, spaceRoles: [] })).toBe(true);
  });

  it("is a coordinator or a manager of any space", () => {
    expect(
      seesCycle({ administers: false, spaceRoles: ["member", "coordinator"] }),
    ).toBe(true);
    expect(seesCycle({ administers: false, spaceRoles: ["manager"] })).toBe(
      true,
    );
  });

  it("is not a member who only belongs to spaces", () => {
    expect(
      seesCycle({ administers: false, spaceRoles: ["member", null] }),
    ).toBe(false);
  });
});
