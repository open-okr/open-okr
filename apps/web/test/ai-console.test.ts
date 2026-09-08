import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ACCESS_LEVELS, navigationFor } from "@openokr/core";
import { AI_PROVIDER_KINDS, MODEL_TIERS } from "@openokr/db";
import { describe, expect, test } from "vitest";

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

const actionsSource = readFileSync(CONSOLE, "utf8");
const pageSource = readFileSync(PAGE, "utf8");

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
