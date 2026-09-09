import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SETTINGS_REGISTRY } from "@openokr/core";
import { describe, expect, test } from "vitest";

/**
 * Onboarding, screen S-34 (P6-G26, GAP-AUDIT G-02).
 *
 * **A first sign-in as owner used to land on an empty Work Map.** Every setting
 * had a working default and nothing told the person who had just created a
 * workspace what to do with it.
 *
 * The writes each step makes are proved elsewhere: they are the writes the
 * product already had. What is checked here is the shape of the offer, the two
 * refusals that keep it from reappearing, and the default that keeps every
 * workspace older than this key out of it.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const page = at("../app/welcome/page.tsx");
const wizard = at("../app/welcome/wizard.tsx");
const actions = at("../app/welcome/actions.ts");
const home = at("../app/(home)/page.tsx");

describe("the setting", () => {
  test("defaults to finished, so no existing workspace is dragged into it", () => {
    const setting = SETTINGS_REGISTRY.find(
      (one) => one.key === "onboardingDone",
    );
    expect(setting).toBeDefined();
    expect(setting?.scope).toBe("workspace");
    expect(setting?.home).toBe("workspaces.settings");
    // True, not false. A workspace nobody marked has nothing pending, which is
    // the right answer for every workspace that existed before the key did.
    // Provisioning is the one place that says otherwise.
    expect(setting?.resolve({})).toBe(true);
  });

  test("provisioning is what marks a new workspace as pending", () => {
    const provisioning = at(
      "../../../packages/core/src/workspaces/provisioning.ts",
    );
    expect(provisioning).toContain("onboardingDone: false");
  });
});

describe("the four steps", () => {
  test("are four, and each one is skippable", () => {
    expect(wizard).toContain(
      'const STEPS = ["basics", "rhythm", "people", "demo"] as const;',
    );
    expect(wizard).toContain('data-testid="welcome-skip"');
    // Skipping advances without writing anything, which is what makes the
    // §4.14 defaults the answer rather than a fallback.
    expect(wizard).toContain(
      "const skip = () => advance(async () => ({ error: null }));",
    );
  });

  test("call writes the product already had, and add no storage", () => {
    for (const action of [
      '"workspace.rename"',
      '"settings.updateWorkspaceGeneral"',
      '"rhythm.update"',
      '"invitations.createPersonalLink"',
      '"workspace.finishOnboarding"',
    ]) {
      expect(actions, action).toContain(action);
    }
    // The demo is the builder P3-T17 wrote, called as a function. The plan row
    // says P3-T17 built "an in-product, flag-gated action" and it did not.
    expect(actions).toContain("buildDemoWorkspace(");
  });

  test("leave demoEnabled alone, because it gates the command", () => {
    // The wizard building the demo once is not a standing instruction to seed
    // again on the next run of the seed command.
    expect(actions).not.toContain("demoEnabled: true");
  });

  test("read their text from the catalogue", () => {
    // The first screen fully in it, which is the pattern P6-G22c follows.
    expect(wizard).toContain("useTranslations");
    expect(wizard).toContain('t("welcome.title")');
  });
});

describe("it refuses to be reachable when it should not be", () => {
  test("a member below full is sent home", () => {
    // The workspace's setup is the owner's, and there is no version of this
    // screen that is useful to somebody it is not for, so it is a redirect
    // rather than an empty state.
    expect(page).toContain("level < ACCESS_LEVELS.full");
    expect(page).toContain('redirect("/")');
  });

  test("a workspace already marked done is sent home", () => {
    expect(page).toContain("read.settings.onboardingDone !== false");
  });

  test("the front door sends a pending workspace here, and nothing else does", () => {
    // Here rather than in the shell: this is the screen a first sign-in lands
    // on, and redirecting from a layout would catch the wizard's own way back.
    expect(home).toContain('redirect("/welcome")');
    expect(home).toContain("welcome.settings.onboardingDone === false");
  });
});
