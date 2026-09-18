import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Contributor onboarding and the agreement workflow (P8-T14).
 *
 * **Every claim here is one a newcomer meets before anybody reviews them**, so
 * every one of them is checked rather than trusted: an issue template that is
 * wrong falls back to a blank box, and a document naming a command that does
 * not exist wastes the evening of the person who tried it.
 *
 * **Read as text, not parsed.** A YAML parser would be a better check and it
 * would be a dependency added for one test, which is not a trade this
 * repository makes: `scripts/check-licences.ts` reads
 * `dependency-review.yml` the same way and for the same reason. GitHub
 * validates the workflow and the templates when they reach it, and what these
 * tests hold is the part GitHub cannot know: whether the words in them are
 * still true.
 *
 * `pnpm check:docs` already refuses a documentation page naming a command that
 * does not exist. What it cannot see is anything under `.github`, which is not
 * a documentation tree.
 */

const at = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const GITHUB = "../../../.github";

describe("the agreement workflow", () => {
  const source = at(`${GITHUB}/workflows/agreement.yml`);

  test("runs on a pull request and nothing else", () => {
    expect(source).toContain("  pull_request:");
    // A push trigger would run it on `main`, where there is no pull request to
    // comment on and every commit is already merged.
    expect(source).not.toContain("\n  push:");
  });

  test("may comment, and may not write to the repository", () => {
    expect(source).toContain("contents: read");
    expect(source).toContain("pull-requests: write");
  });

  test("exempts bots, the way the gate in ci.yml does", () => {
    expect(source).toContain("[bot]");
  });

  test("tells the contributor the commands that fix it", () => {
    expect(source).toContain("git commit --amend -s --no-edit");
    expect(source).toContain("git rebase --signoff origin/main");
    expect(source).toContain("git config --global format.signOff true");
  });

  test("does not claim to check the licence agreement, which it cannot see", () => {
    // The agreement is signed through an app installed on the repository,
    // which is an account-level act rather than a file in it. A workflow
    // claiming to check it would be worse than one saying nothing.
    expect(source).toContain(
      "The contributor licence agreement is not checked here.",
    );
  });

  test("is not a second gate, and says which one blocks the merge", () => {
    expect(source).toContain("`check:signoff` in `ci.yml` is still");
  });
});

describe("the issue templates", () => {
  for (const name of ["bug", "feature"]) {
    test(`${name} is a form with a label and a body`, () => {
      const template = at(`${GITHUB}/ISSUE_TEMPLATE/${name}.yml`);
      expect(template).toContain("name:");
      expect(template).toContain("labels:");
      expect(template).toContain("body:");
    });
  }

  test("the bug template warns against pasting a credential", () => {
    expect(at(`${GITHUB}/ISSUE_TEMPLATE/bug.yml`)).toContain(
      "Never paste a token",
    );
  });

  test("the feature template says a method change is a maintainer's decision", () => {
    // METHOD.md is the practice canon and changing a rule is never a pull
    // request somebody opens on their own. Saying so on the form is cheaper
    // than saying it on the issue.
    expect(at(`${GITHUB}/ISSUE_TEMPLATE/feature.yml`)).toContain(
      "made by a maintainer",
    );
  });

  test("the config sends security reports somewhere other than an issue", () => {
    expect(at(`${GITHUB}/ISSUE_TEMPLATE/config.yml`)).toContain(
      "Never in an issue",
    );
  });
});

describe("contributing", () => {
  const contributing = at("../../../CONTRIBUTING.md");

  test("names where to start before it names the rules", () => {
    const start = contributing.indexOf("## Where to start");
    const rules = contributing.indexOf("## Code rules");
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(rules);
  });

  test("keeps the sign-off and the agreement apart", () => {
    // Two different things, both needed, and conflating them is how a
    // contributor concludes they have done one by doing the other.
    expect(contributing).toContain(
      "The sign-off says the code is yours to give",
    );
  });

  test("refuses to call a plan task a good first issue", () => {
    const list = at("../../../docs/runbooks/good-first-issues.md");
    expect(list).toContain(
      "Never label a task from the implementation plan as a good first issue.",
    );
  });
});

describe("the release runbook", () => {
  const release = at("../../../docs/runbooks/release.md");

  test("says the three things the workflow cannot prove", () => {
    // The acceptance criterion for the launch is about a clean machine and an
    // upgrade from the previous release. Neither is something a tag's own
    // workflow can check, so the runbook is where they live.
    expect(release).toContain("Install it on a clean machine");
    expect(release).toContain("Upgrade an instance from the previous release");
    expect(release).toContain("Install the chart");
  });

  test("refuses to delete a tag, and says what to do instead", () => {
    expect(release).toContain("Do not delete the tag");
    expect(release).toContain("Cut the next patch instead");
  });
});
