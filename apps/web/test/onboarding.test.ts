import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SETTINGS_REGISTRY } from "@openokr/core";
import { CATALOGUES } from "@openokr/ui";
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

describe("the five steps", () => {
  test("are five, and each one is skippable", () => {
    // Four until P8-T12, which put the starting templates between the people
    // question and the demo: a template is a first quarter somebody edits, the
    // demo is a cast to look at, and the order asks the smaller one first.
    expect(wizard).toContain(
      'const STEPS = ["basics", "rhythm", "people", "template", "demo"] as const;',
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
    // The template applier is the same shape: it writes only through
    // callAction, so a template cannot write a row the product would not.
    expect(actions).toContain("applyTemplate(");
  });

  test("leave demoEnabled alone, because it gates the command", () => {
    // The wizard building the demo once is not a standing instruction to seed
    // again on the next run of the seed command.
    expect(actions).not.toContain("demoEnabled: true");
  });

  test("read their text from the catalogue", () => {
    // The first screen fully in it, which is the pattern P6-G22c follows.
    expect(wizard).toContain("useTranslations");
    expect(wizard).toContain('t("common.title")');
  });

  test("are counted from the list, never written as a word (L-08)", () => {
    // "Four questions" sat above a "1 / 5" counter from the day P8-T12 added
    // the template step: the sentence and the list were two places to change.
    // The count is now the list's own length, in the sentence as in the
    // counter, so a sixth step changes both or neither.
    expect(wizard.replace(/\s+/g, " ")).toContain(
      't("welcome.explains", { count: STEPS.length })',
    );
    // The counter beside it, built from the same list.
    expect(wizard).toContain(`$\{index + 1} / $\{STEPS.length}`);
    for (const locale of ["en", "ms"] as const) {
      const explains = CATALOGUES[locale]["welcome.explains"] ?? "";
      expect(explains, locale).toContain("{count}");
      // No number written as a word, in either language.
      expect(explains, locale).not.toMatch(
        /\b(four|five|six|empat|lima|enam)\b/i,
      );
    }
  });

  test("open on what the workspace holds now, so a reopened one keeps it (L-08)", () => {
    // Pressing Continue on a reopened wizard writes back whatever the step
    // shows. A constant there would overwrite the rhythm card's answer with
    // the default, which is exactly the erasure "resumable" must not cause.
    expect(page).toContain('callAction(context, "rhythm.read", {})');
    expect(page).toContain("frequency={rhythm.defaultCheckInFrequency}");
    expect(wizard).toContain("useState<CheckInFrequency>(currentFrequency)");
    expect(wizard).not.toContain('>("weekly")');
    expect(page).toContain("workspaceName={workspace.name}");
  });
});

describe("resumable from admin (L-08)", () => {
  const card = at("../app/admin/general/setup-card.tsx");
  const cardActions = at("../app/admin/general/setup-actions.ts");
  const general = at("../app/admin/general/page.tsx");

  test("General in admin carries the card, reading the stored flag", () => {
    // Inside the admin layout, which refuses anybody below `full`, and the
    // action itself is declared `full` as well, so neither half relies on
    // the other.
    expect(general).toContain(
      "<SetupCard done={read.settings.onboardingDone !== false} />",
    );
  });

  test("reopening is the registered action, and then goes to the wizard", () => {
    expect(cardActions).toContain('"workspace.reopenOnboarding"');
    expect(cardActions).toContain('redirect("/welcome")');
    // A refusal is shown on the card rather than swallowed. A frozen
    // workspace is the case that meets it.
    expect(cardActions).toContain("return { error: error.message };");
    expect(card).toContain("<ActionForm action={reopenSetup}");
    expect(card).toContain('data-testid="reopen-onboarding"');
  });

  test("a setup already open links to it rather than writing the flag again", () => {
    expect(card).toContain('href="/welcome"');
    expect(card).toContain('data-testid="continue-onboarding"');
  });

  test("the action is declared full and writes nothing but the flag", () => {
    const workspaceActions = at(
      "../../../packages/core/src/actions/workspace.ts",
    );
    const start = workspaceActions.indexOf(
      'name: "workspace.reopenOnboarding"',
    );
    expect(start).toBeGreaterThan(-1);
    const body = workspaceActions.slice(
      start,
      workspaceActions.indexOf("export const", start),
    );
    expect(body).toContain("access: ACCESS_LEVELS.full");
    expect(body).toContain(`'{"onboardingDone": false}'::jsonb`);
  });
});

describe("the first-visit tour (L-08)", () => {
  const tour = at("../app/first-visit-tour.tsx");
  const tourActions = at("../app/tour-actions.ts");
  const css = at("../app/globals.css");

  test("is drawn on the Work Map, only for a member who has not finished it", () => {
    expect(home).toContain('callAction(context, "people.readOwnTour", {})');
    expect(home).toContain("{tour.finished ? null : <FirstVisitTour />}");
    // After the setup redirect, so an owner meets the setup first.
    expect(home.indexOf('"people.readOwnTour"')).toBeGreaterThan(
      home.indexOf('redirect("/welcome")'),
    );
  });

  test("is ended by the member's own registered write", () => {
    expect(tourActions).toContain('"people.finishOwnTour"');
    expect(tour).toContain("finishTour()");
  });

  test("outlines every stop that has something on screen to outline", () => {
    // A check-in is a composer, not a thing on the Work Map, so it is the
    // one stop that explains without pointing.
    for (const stop of ["work-map", "review", "cycle-strip", "search"]) {
      expect(css, stop).toContain(`:root[data-tour-stop="${stop}"]`);
    }
    expect(at("../app/work-map.tsx")).toContain('data-tour-target="work-map"');
    expect(at("../app/work-map-header.tsx")).toContain(
      'data-tour-target="cycle-strip"',
    );
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

  test("the front door sends only somebody who may finish the setup (P8-G05a)", () => {
    // **The two screens have to agree on who this is for, or they loop.** S-34
    // refuses anybody below `full` and sends them back to the front door; if
    // the front door does not apply the same condition, a member below `full`
    // on a pending workspace bounces between the two for ever.
    //
    // Live for a few minutes on 22 September 2026 and reported from a browser,
    // not by a test. It was invisible before that day because the front door
    // read the settings through an action declared `full`, so for an ordinary
    // member it threw and this line was never reached: fixing that read turned
    // a broken screen into an infinite loop, which is the worse of the two.
    //
    // Asserted as the two conditions in one expression rather than as their
    // presence anywhere in the file, because that is the part that has to hold.
    // Whitespace is collapsed first: the formatter breaks the expression across
    // lines when it grows, and a test that failed for that reason would be
    // measuring line length rather than the rule.
    expect(home.replace(/\s+/g, " ")).toContain(
      "level >= ACCESS_LEVELS.full && welcome.settings.onboardingDone === false",
    );
    // And the level has to be resolved before the redirect decides, or the
    // expression above reads an undefined binding.
    expect(
      home.indexOf("const level = await resolveAccessLevelFor"),
    ).toBeLessThan(home.indexOf('redirect("/welcome")'));
  });
});
