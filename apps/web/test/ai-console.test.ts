import { fileURLToPath } from "node:url";
import { ACCESS_LEVELS, navigationFor } from "@openokr/core";
import { AI_PROVIDER_KINDS, MODEL_TIERS } from "@openokr/db";
import { describe, expect, test } from "vitest";
import { readScreen } from "./screen-text.ts";

/**
 * The AI console covers what the registry offers (S-37, P6-G12a).
 *
 * **B-05 was twenty-four registered actions and not one caller.** The provider
 * configuration, the envelope-encrypted credentials, rotation, the model
 * catalogue and the tier routing were built across P2-T13, P2-T14 and P4-T14
 * and no screen reached any of them, so a self-hosted instance shipped with AI
 * permanently off and no way to turn it on.
 *
 * These tests read the source rather than render it, for the same reason
 * `reachability.test.ts` does: what went wrong here was not a broken component,
 * it was a whole domain nobody had wired up, and that is visible in which
 * actions the screen names.
 */

const CONSOLE = fileURLToPath(
  new URL("../app/admin/ai/actions.ts", import.meta.url),
);
const PAGE = fileURLToPath(
  new URL("../app/admin/ai/page.tsx", import.meta.url),
);
const GOVERNANCE = fileURLToPath(
  new URL("../app/admin/ai/governance.tsx", import.meta.url),
);

const actionsSource = readScreen(CONSOLE);
const pageSource = readScreen(PAGE);
const governanceSource = readScreen(GOVERNANCE);

describe("the AI console", () => {
  test("is in the admin navigation", () => {
    const admin = navigationFor("admin", ACCESS_LEVELS.full);
    const entry = admin.find((item) => item.id === "admin-ai");
    expect(entry?.href).toBe("/admin/ai");
    // A provider key books spend for the whole workspace, so the level is the
    // same one the channels card asks for.
    expect(entry?.minLevel).toBe(ACCESS_LEVELS.full);
  });

  test("calls every provider, credential and model action P6-G12a owns", () => {
    // Named individually rather than counted. A count passes when one action
    // is swapped for another, and the point of this row is that each of these
    // had no caller at all.
    const owned = [
      "ai.readProviderConfig",
      "ai.updateProviderConfig",
      "ai.setWorkspaceCredential",
      "ai.removeWorkspaceCredential",
      "ai.rotateCredentials",
      "ai.readModelCatalog",
      "ai.addCustomModel",
      "ai.removeCustomModel",
      "ai.readTierRouting",
      "ai.setTierPolicy",
      "ai.removeTierPolicy",
    ];
    const both = `${actionsSource}${pageSource}`;
    const missing = owned.filter((name) => !both.includes(name));
    expect(missing).toEqual([]);
  });

  test("never renders a stored key back", () => {
    // The whole reason the credentials are envelope-encrypted. The card shows
    // a masked hint and a status; a field pre-filled with the current key "so
    // you can check it" would be a screen that displays a provider key.
    expect(pageSource).toContain("workspaceKeyHint");
    expect(pageSource).not.toMatch(/defaultValue=\{[^}]*apiKey/);
    expect(pageSource).toMatch(/name="apiKey"[\s\S]{0,120}type="password"/);
  });

  test("offers every provider and every tier the schema declares", () => {
    // Enumerated from the schema rather than written out, which is what the
    // first draft of `actions.ts` got wrong: it hand-copied a provider union
    // and three of its five names were not providers this product has.
    for (const kind of AI_PROVIDER_KINDS) {
      expect(pageSource, `${kind} is not offered`).toContain(kind);
    }
    for (const tier of MODEL_TIERS) {
      expect(pageSource, `${tier} has no words`).toContain(tier);
    }
  });

  test("says what it is refusing when the reader is below full", () => {
    // Said rather than hidden: somebody who cannot set a key should still know
    // the product has AI, and that nothing they need is waiting on it.
    expect(pageSource).toContain("ACCESS_LEVELS.full");
    expect(pageSource).toMatch(/works with AI off/);
  });
});

describe("the AI console's second half (P6-G12b)", () => {
  test("calls every feature, prompt, budget and usage action", () => {
    const owned = [
      "ai.readFeatureSettings",
      "ai.updateFeatureSetting",
      "ai.readPrompt",
      "ai.updatePrompt",
      "ai.restorePrompt",
      "ai.readBudgets",
      "ai.setBudget",
      "ai.removeBudget",
      "ai.readUsageSummary",
    ];
    const all = `${actionsSource}${pageSource}${governanceSource}`;
    const missing = owned.filter((name) => !all.includes(name));
    expect(missing).toEqual([]);
  });

  test("switches every assist the three key maps declare", async () => {
    // Enumerated from the maps rather than written out, so an assist added
    // next month gets a switch without anybody remembering this screen. The
    // card builds its list the same way, which is what this asserts.
    const { ASSIST_FEATURE_KEYS, REVIEW_ASSIST_KEYS, RHYTHM_ASSIST_KEYS } =
      await import("@openokr/core");
    const declared = [
      ...Object.values(ASSIST_FEATURE_KEYS),
      ...Object.values(REVIEW_ASSIST_KEYS),
      ...Object.values(RHYTHM_ASSIST_KEYS),
    ];
    expect(declared.length).toBeGreaterThan(10);
    for (const source of [
      "ASSIST_FEATURE_KEYS",
      "REVIEW_ASSIST_KEYS",
      "RHYTHM_ASSIST_KEYS",
    ]) {
      expect(governanceSource, `${source} is not read`).toContain(source);
    }
  });

  test("says a budget disables rather than breaks", () => {
    // The product's own promise: crossing a cap stops the AI call and leaves
    // every deterministic path untouched. A screen that implied otherwise
    // would make an administrator afraid to set one.
    expect(governanceSource).toMatch(/deterministic path/);
    expect(governanceSource).toMatch(/halts with the reason/);
  });

  test("builds its budget choices from the schema, not from a copy", async () => {
    // **This asserted the wrong thing first, and the card was right.** It
    // looked for the literal "tokens" in the source, which only appears if
    // somebody hand-copies the metric list; the card maps over
    // `BUDGET_METRICS` instead, so the literal is correctly absent. A test
    // that fails when the code does the right thing is worse than no test.
    //
    // What matters is that the three lists are read rather than restated, the
    // same property the assist-keys test above checks.
    const { BUDGET_SCOPES, BUDGET_METRICS, BUDGET_PERIODS } = await import(
      "@openokr/db"
    );
    expect(
      BUDGET_SCOPES.length + BUDGET_METRICS.length + BUDGET_PERIODS.length,
    ).toBeGreaterThan(5);
    for (const name of ["BUDGET_SCOPES", "BUDGET_METRICS", "BUDGET_PERIODS"]) {
      expect(governanceSource, `${name} is not read`).toContain(
        `{${name}.map(`,
      );
    }
  });

  test("reads every prompt the package ships a default for", () => {
    // `knownPromptKeys` rather than a list here: the editor should grow with
    // the catalogue, and a hard-coded pair would silently stop covering it.
    expect(pageSource).toContain("knownPromptKeys()");
  });
});
