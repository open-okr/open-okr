import { describe, expect, it } from "vitest";
import { ACCESS_LEVELS } from "../src/access/levels.ts";
import { ACTIONS, actionNames, getAction } from "../src/actions/registry.ts";

/**
 * The action contract registry (TECHNICAL-PLAN §14).
 *
 * Every read and write is declared here once, with its schemas, its required
 * access level and its safety class. REST, OpenAPI, the MCP catalogue, the
 * command line and chat commands are all projections of this list, so a gap
 * here becomes a gap on six surfaces.
 */

describe("the registry", () => {
  it("declares at least the actions this task ships", () => {
    expect(actionNames()).toContain("workspace.rename");
    expect(actionNames()).toContain("workspace.provision");
  });

  it("has no duplicate names", () => {
    const names = actionNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it("names every action as domain.verb, which the projections rely on", () => {
    for (const name of actionNames()) {
      expect(name, `${name} is not domain.verb`).toMatch(
        /^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/,
      );
    }
  });

  it("gives every action a summary, schemas, an access level and a safety class", () => {
    for (const action of ACTIONS) {
      expect(
        action.summary.length,
        `${action.name} has no summary`,
      ).toBeGreaterThan(0);
      expect(action.input, `${action.name} has no input schema`).toBeDefined();
      expect(
        action.output,
        `${action.name} has no output schema`,
      ).toBeDefined();
      expect(
        Object.values(ACCESS_LEVELS),
        `${action.name} has an unknown access level`,
      ).toContain(action.access);
      expect(["read", "write", "destructive"]).toContain(action.safety);
    }
  });

  it("requires at least edit for anything that writes, except commenting", () => {
    // A write action that only asked for view would be a silent escalation,
    // and that is what this guards: every write needs more than view.
    //
    // The floor is `edit` everywhere except the `comments` domain. TECHNICAL-
    // PLAN §4.1 defines four levels, and `comment` (40) sits between view and
    // edit for exactly one purpose: someone who may discuss a goal without
    // being able to change it. Forcing a comment write up to `edit` would make
    // that level unreachable for the thing it is named after, and would hand
    // every commenter the right to rewrite the objective. The narrower grant
    // is the safer one here, which is the opposite of the usual direction.
    //
    // P3-T07 hit this rule from the other side and widened `acknowledge` to
    // `edit`, recording the cost. That was right: acknowledging a check-in is
    // a state change on the goal. Writing a comment is not.
    for (const action of ACTIONS) {
      if (action.safety === "read") {
        continue;
      }
      const discussion =
        action.name.startsWith("comments.") ||
        action.name.startsWith("reactions.");
      // `nudges.snooze` is the second exception, and for a related reason
      // (P4-T04c). It writes to the member's own nudge rows and to nothing
      // else: it changes what the product says to them, never what the work
      // says. A member at `view` still receives nudges, so putting the floor at
      // `edit` would leave the people with the least power the only ones who
      // cannot make the product stop talking to them. The action refuses
      // somebody else's nudge as a not-found, which is what keeps the narrow
      // grant safe.
      const ownMessages = action.name === "nudges.snooze";
      // The copilot is the third, and it is `nudges.snooze`'s reason again
      // (P4-T14a-a): both writes touch one member's own conversation and
      // nothing in the workspace. A member who may read a space but not change
      // it should be able to ask about it, and retrieval decides what they are
      // answered from by their own access, so the narrow grant leaks nothing.
      // Both actions refuse a thread that is not the caller's as a not-found,
      // which is what `nudges.snooze` relies on too.
      const ownConversation = action.name.startsWith("copilot.");
      // Channel identities are the fourth, and it is `nudges.snooze`'s reason
      // once more (P5-T01b-a). Linking and unlinking touch one row that is
      // about the member and nobody else, and both resolve the member from the
      // caller's own session rather than from an input, so there is no
      // identifier a caller could pass to reach somebody else's. A member at
      // `view` still receives nudges, and telling the product where to send
      // them cannot be a privilege only editors have. `channels.connect`,
      // `channels.disconnect` and `channels.send` are workspace-wide and stay
      // at `full`.
      const ownIdentity =
        action.name === "channels.linkIdentity" ||
        action.name === "channels.unlinkIdentity" ||
        // Asking for a code to prove their own account (P5-T02a). The member
        // comes from the session, the code is theirs alone, and it grants
        // nothing except the ability to be reached.
        action.name === "channels.startLink";
      const floor =
        discussion || ownMessages || ownConversation || ownIdentity
          ? ACCESS_LEVELS.comment
          : ACCESS_LEVELS.edit;
      expect(
        action.access,
        `${action.name} writes but only needs view`,
      ).toBeGreaterThanOrEqual(floor);
      // No write is ever reachable at view, whatever its domain.
      expect(
        action.access,
        `${action.name} writes at view level`,
      ).toBeGreaterThan(ACCESS_LEVELS.view);
    }
  });

  it("routes every mutating action through the Operation pipeline", () => {
    // The structural guarantee behind "a mutation without its audit row is
    // impossible": a write action is built from an operation spec, so there is
    // no shape of registry entry that writes without the pipeline.
    for (const action of ACTIONS) {
      if (action.safety !== "read") {
        expect(
          action.runsThroughPipeline,
          `${action.name} bypasses the pipeline`,
        ).toBe(true);
      }
    }
  });

  it("looks an action up by name", () => {
    expect(getAction("workspace.rename")?.name).toBe("workspace.rename");
    expect(getAction("workspace.nonesuch")).toBeUndefined();
  });
});

describe("action input validation", () => {
  it("rejects input that does not match the schema", () => {
    const action = getAction("workspace.rename");
    if (!action) {
      throw new Error("workspace.rename is missing");
    }
    expect(action.input.safeParse({ name: "" }).success).toBe(false);
    expect(action.input.safeParse({}).success).toBe(false);
    expect(action.input.safeParse({ name: "A real name" }).success).toBe(true);
  });

  it("trims and bounds a workspace name rather than storing anything at all", () => {
    const action = getAction("workspace.rename");
    if (!action) {
      throw new Error("workspace.rename is missing");
    }
    expect(action.input.safeParse({ name: "   " }).success).toBe(false);
    expect(action.input.safeParse({ name: "x".repeat(201) }).success).toBe(
      false,
    );
  });
});
