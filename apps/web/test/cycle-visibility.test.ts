import { describe, expect, it } from "vitest";
import { seesCycle } from "../lib/cycle-visibility.ts";

/**
 * Who sees Cycle in the sidebar, and the phase strip above every screen
 * (navigation-five-areas.md, OKRGoal UX review N3): the people who run the
 * cycle, not every member. The route itself stays open at view.
 */
describe("who sees Cycle", () => {
  it("is a workspace administrator", () => {
    expect(
      seesCycle({ administers: true, setsUpCycle: true, spaceRoles: [] }),
    ).toBe(true);
  });

  it("is a coordinator or a manager of any space", () => {
    expect(
      seesCycle({
        administers: false,
        setsUpCycle: false,
        spaceRoles: ["member", "coordinator"],
      }),
    ).toBe(true);
    expect(
      seesCycle({
        administers: false,
        setsUpCycle: false,
        spaceRoles: ["manager"],
      }),
    ).toBe(true);
  });

  // UAT 0.8.0 F-03: plan 0.8.0 R1 lets an Admin set up a cycle, but the
  // sidebar asked for administration (Full), so an Admin was never shown the
  // way to the screen R1 opened to them.
  it("is whoever may set up a cycle, an Admin included", () => {
    expect(
      seesCycle({ administers: false, setsUpCycle: true, spaceRoles: [] }),
    ).toBe(true);
  });

  it("is not a member who only belongs to spaces", () => {
    expect(
      seesCycle({
        administers: false,
        setsUpCycle: false,
        spaceRoles: ["member", null],
      }),
    ).toBe(false);
  });
});
