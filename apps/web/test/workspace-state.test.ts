import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * The workspace state gets a control and an explanation (§4.1, P6-G25).
 *
 * **The enforcement shipped at P2-T09 and nothing could reach it.**
 * `workspace.setState` has been in the registry since then, `isRecoveryAction`
 * has kept it usable during a freeze since then, and no screen ever called it:
 * P6-T07's rehearsal runbook asks an operator to freeze an instance and lift it
 * again, and there was nothing to press. A member met a refused save with a
 * message about access and no way to learn the workspace itself had stopped.
 *
 * The refusal itself is proved against a real database in `packages/core`. What
 * is checked here is that the switch exists, that it cannot lock itself away,
 * and that the explanation reaches every screen.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const card = at("../app/admin/general/workspace-state-card.tsx");
const page = at("../app/admin/general/page.tsx");
const banner = at("../lib/workspace-state.tsx");
const shell = at("../lib/app-shell.tsx");
const memberships = at("../../../packages/core/src/workspaces/memberships.ts");

describe("the state control", () => {
  test("calls the action P2-T09 left with no caller", () => {
    expect(card).toContain('"workspace.setState"');
    expect(page).toContain("<WorkspaceStateCard");
  });

  test("offers all three states and never the current one", () => {
    // A form per state rather than a select and a save: the change is
    // immediate and consequential, and a select holding "frozen" until
    // somebody found a save button is the shape most likely to freeze a
    // workspace by accident.
    for (const state of ["active", "read_only", "frozen"]) {
      expect(card, state).toContain(`value: "${state}"`);
    }
    expect(card).toContain("STATES.filter((one) => one.value !== state)");
  });

  test("revalidates the whole tree, because the banner is on every screen", () => {
    expect(card).toContain('revalidatePath("/", "layout")');
  });
});

describe("the explanation", () => {
  test("reaches every screen through the shell", () => {
    expect(shell).toContain("<WorkspaceStateBanner");
    // Rendered above the content, not around it: reads are unaffected by
    // design and the admin recovery list has to stay reachable, so a modal
    // would contradict both halves of §4.1.
    expect(banner).not.toContain("fixed inset-0");
    expect(banner).toContain('href="/admin/general"');
  });

  test("says nothing at all when the workspace is active", () => {
    expect(banner).toContain('if (state === "active") {');
    expect(shell).toContain('workspace.state === "active" ? null :');
  });

  test("distinguishes read-only from frozen, which the pipeline does not", () => {
    // `operations/freeze.ts` treats them identically and says so. A member
    // does not care about that: one is a decision about how the workspace is
    // used, the other is an operator holding it still.
    expect(banner).toContain("This workspace is frozen");
    expect(banner).toContain("This workspace is read only");
  });

  test("the state travels on the membership every page already resolves", () => {
    // Rather than a read of its own: every signed-in page resolves its
    // membership, and none of them could see this one column.
    expect(memberships).toContain("state: workspaces.state");
    expect(memberships).toContain(
      'readonly state: "active" | "read_only" | "frozen";',
    );
  });
});
