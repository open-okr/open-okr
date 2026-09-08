import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AGENT_AUTONOMIES } from "@openokr/db";
import { describe, expect, test } from "vitest";

/**
 * An agent's write policy and its scope are set from the product
 * (S-38, P6-G13b, GAP-AUDIT G-05).
 *
 * **Two things were missing and one was wrong.** `agents.create` took an
 * autonomy and no action could change it, so the propose-and-approve default
 * was in practice permanent. `agents.bindScope` had no surface at all. And its
 * own summary has said "never workspace-wide" since P4-T05a while enforcing
 * nothing: `resolveSubjectContext` resolves `workspace` like any other
 * subject, so a caller could hand an agent authority over everything.
 *
 * The refusal and the policy move are proved against a real database in
 * `packages/core`. What is checked here is that the screen offers all three
 * policies with what each one does, and that the workspace is not offered as
 * a binding target.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const card = at("../app/admin/agents/agent-policy.tsx");
const actions = at("../app/admin/agents/actions.ts");
const page = at("../app/admin/agents/page.tsx");

describe("the agent policy card", () => {
  test("offers every policy the column can hold", () => {
    // Enumerated from the table, so a fourth policy added later appears here
    // without a change to the component. The list is passed in rather than
    // imported: a client component that imports a value from `@openokr/db`
    // pulls the database layer into its bundle and the build fails on `dns`.
    expect(page).toContain("autonomies={[...AGENT_AUTONOMIES]}");
    expect(card).toContain("autonomies.map");
    expect(card).not.toContain('from "@openokr/db"');
    expect(card).not.toContain('from "@openokr/core"');
    for (const autonomy of AGENT_AUTONOMIES) {
      expect(card, `no wording for ${autonomy}`).toContain(`${autonomy}:`);
    }
  });

  test("says what each policy does, not just its name", () => {
    // "Scoped direct" is the one that writes without asking, and a screen
    // that offers it as a bare label gets it chosen by accident.
    expect(card).toContain("commits nothing at all");
    expect(card).toContain("into the review queue");
    expect(card).toContain("only inside the scopes bound below");
  });

  test("confirms before widening an agent to direct writes", () => {
    expect(card).toContain('option === "scoped_direct" &&');
    expect(card).toContain("window.confirm");
  });

  test("does not offer the workspace as a binding target", () => {
    // CLAUDE.md: an agent gets bindings on named spaces, goals and KPI trees
    // only, and there is no service account with ambient authority.
    expect(card).toContain('{ type: "space"');
    expect(card).toContain('{ type: "goal"');
    expect(card).toContain('{ type: "kpi_tree"');
    expect(card).not.toContain('{ type: "workspace"');
  });

  test("and says plainly that the picker is a default, not an authorisation", () => {
    // P6-G13b tried to refuse a workspace binding and could not keep it:
    // `runOperation` measures an actor's level against the workspace's own
    // context, so enforcing the rule makes `scoped_direct` a mode no agent can
    // act in. The conflict is P6-G13c. A refusal in this action alone would
    // only make the screen and the API disagree.
    expect(actions).not.toContain('input.resourceType === "workspace"');
    expect(card).toContain("though nothing refuses one yet");
  });

  test("calls the action that did not exist before this task", () => {
    expect(actions).toContain('"agents.setAutonomy"');
    expect(actions).toContain('"agents.bindScope"');
    expect(page).toContain("<AgentPolicy");
  });
});
