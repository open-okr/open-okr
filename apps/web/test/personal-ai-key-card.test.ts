import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ACCESS_LEVELS, navigationFor } from "@openokr/core";
import { CATALOGUES, TranslationsProvider, translate } from "@openokr/ui";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readScreen } from "./screen-text.ts";

/**
 * The card where a member keeps their own AI key (completeness review M-36).
 *
 * `ai.setPersonalCredential`, `ai.removePersonalCredential` and
 * `ai.readOwnCredentialStatus` were built at P2-T14 and nothing in the browser
 * called them. These prove the screen's half: what each form posts, what it
 * refuses before posting, that no answer and no render carries the key, and
 * that each of the page's states says what it is. The actions themselves are
 * proved against a database in `packages/core/test/ai-personal-key.test.ts`,
 * and which key a request then uses in `personal-ai-key-precedence.test.ts`.
 */

const KEY = "sk-ant-member-own-key-7Q4z";

const callAction = vi.fn();
const revalidatePath = vi.fn();
const accessLevel = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));
vi.mock("../lib/translations", () => ({
  getTranslations: async () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      translate(CATALOGUES.en, key, values),
  }),
}));
vi.mock("../lib/workspace", () => ({
  requireWorkspace: async () => ({
    session: { user: { id: "user-1" } },
    workspace: { workspaceId: "workspace-1", memberId: "member-1" },
    memberships: [],
  }),
}));
vi.mock("../lib/access", () => ({
  resolveAccessLevelFor: (...args: unknown[]) => accessLevel(...args),
}));
vi.mock("../lib/pool", () => ({ getPool: () => "the pool" }));
vi.mock("../lib/secrets", () => ({ getKeyRing: () => "the ring" }));
vi.mock("@openokr/core", async (original) => ({
  ...(await original<typeof import("@openokr/core")>()),
  callAction: (...args: unknown[]) => callAction(...args),
}));

const { OperationError } = await import("@openokr/core");
const { savePersonalKey, removePersonalKey } = await import(
  "../app/account/ai/actions"
);
const { default: PersonalAIKeysPage } = await import("../app/account/ai/page");

const NOTHING = { ok: true, message: "" };

function submitted(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    form.set(name, value);
  }
  return form;
}

beforeEach(() => {
  callAction.mockReset();
  revalidatePath.mockReset();
  accessLevel.mockReset();
  accessLevel.mockResolvedValue(ACCESS_LEVELS.edit);
});

describe("storing a key", () => {
  it("posts it once, sealed with the ring, as the signed-in member", async () => {
    callAction.mockResolvedValue({
      provider: "anthropic",
      keyHint: "••••7Q4z",
      status: "unverified",
    });
    const state = await savePersonalKey(
      NOTHING,
      submitted({ provider: "anthropic", apiKey: `  ${KEY}\n` }),
    );

    expect(callAction).toHaveBeenCalledTimes(1);
    const [context, action, input] = callAction.mock.calls[0] as [
      { actor: { userId: string }; ring: unknown; workspaceId: string },
      string,
      unknown,
    ];
    expect(action).toBe("ai.setPersonalCredential");
    // Trimmed, and nothing else: there is no member id a form could name.
    expect(input).toEqual({ provider: "anthropic", apiKey: KEY });
    expect(context.actor.userId).toBe("user-1");
    expect(context.workspaceId).toBe("workspace-1");
    expect(context.ring).toBe("the ring");

    expect(state.ok).toBe(true);
    expect(state.message).toBe(
      "Stored. Your next request to Anthropic uses it. It has not been tried yet, so it is not yet known to work.",
    );
    expect(JSON.stringify(state)).not.toContain(KEY);
    expect(revalidatePath).toHaveBeenCalledWith("/account/ai");
  });

  it.each([
    ["a space inside it", "sk-ant-part one"],
    ["a line break inside it", "sk-ant-part\none"],
    ["curly quotes", "“sk-ant-quoted”"],
    ["a pasted document", `sk-${"x".repeat(5000)}`],
  ])(
    "refuses a key with %s before sending anything, and does not repeat it",
    async (_label, malformed) => {
      const state = await savePersonalKey(
        NOTHING,
        submitted({ provider: "anthropic", apiKey: malformed }),
      );
      expect(callAction).not.toHaveBeenCalled();
      expect(state.ok).toBe(false);
      expect(state.message).toBe(
        "That is not a key this can store. A key is letters, digits and plain symbols, with no spaces, line breaks or curly quotes inside it. Nothing was stored.",
      );
      expect(state.message).not.toContain(malformed.trim().slice(0, 12));
    },
  );

  it("asks for a key when the field was empty", async () => {
    const state = await savePersonalKey(
      NOTHING,
      submitted({ provider: "anthropic", apiKey: "   " }),
    );
    expect(callAction).not.toHaveBeenCalled();
    expect(state).toEqual({ ok: false, message: "Paste a key first." });
  });

  it("refuses a provider this product does not have", async () => {
    const state = await savePersonalKey(
      NOTHING,
      submitted({ provider: "azure", apiKey: KEY }),
    );
    expect(callAction).not.toHaveBeenCalled();
    expect(state.ok).toBe(false);
  });

  it("says the workspace stopped taking one, by the provider's name", async () => {
    callAction.mockRejectedValue(
      new OperationError(
        "not_found",
        "anthropic does not accept a personal key in this workspace.",
      ),
    );
    const state = await savePersonalKey(
      NOTHING,
      submitted({ provider: "anthropic", apiKey: KEY }),
    );
    expect(state).toEqual({
      ok: false,
      message:
        "Your workspace no longer takes a personal key for Anthropic, so nothing was stored.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("says a level that cannot store one plainly", async () => {
    callAction.mockRejectedValue(
      new OperationError("forbidden", "needs a higher access level"),
    );
    const state = await savePersonalKey(
      NOTHING,
      submitted({ provider: "anthropic", apiKey: KEY }),
    );
    expect(state.message).toBe(
      "Your access in this workspace does not let you change a key at the moment. Nothing changed.",
    );
  });

  it("never passes a failure's own message through, whatever it holds", async () => {
    // A failure below this screen is not written to leave the key out, so
    // its message is never shown: the member reads a sentence from the
    // catalogue instead.
    callAction.mockRejectedValue(new Error(`could not seal ${KEY}`));
    const state = await savePersonalKey(
      NOTHING,
      submitted({ provider: "anthropic", apiKey: KEY }),
    );
    expect(state).toEqual({
      ok: false,
      message: "That did not work, and nothing changed.",
    });
  });
});

describe("removing a key", () => {
  it("removes the member's own, by provider alone", async () => {
    callAction.mockResolvedValue({ provider: "openrouter" });
    const state = await removePersonalKey(
      NOTHING,
      submitted({ provider: "openrouter" }),
    );
    expect(callAction).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { kind: "human", userId: "user-1" } }),
      "ai.removePersonalCredential",
      { provider: "openrouter" },
    );
    expect(state).toEqual({
      ok: true,
      message:
        "Removed. Your requests to OpenRouter no longer use a key of your own.",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/account/ai");
  });

  it("says when there was nothing to remove", async () => {
    callAction.mockRejectedValue(
      new OperationError("not_found", "No personal key stored for openrouter."),
    );
    const state = await removePersonalKey(
      NOTHING,
      submitted({ provider: "openrouter" }),
    );
    expect(state.message).toBe(
      "You have no key stored for OpenRouter, so there was nothing to remove.",
    );
  });
});

/** The page over what `ai.readOwnCredentialStatus` answered. */
async function renderPage(rows: readonly Record<string, unknown>[]) {
  callAction.mockResolvedValue(rows);
  const page = (await PersonalAIKeysPage()) as ReactNode;
  return renderToString(
    createElement(
      TranslationsProvider,
      { locale: "en" } as ComponentProps<typeof TranslationsProvider>,
      page,
    ),
  );
}

const STORED = {
  provider: "anthropic",
  allowUserKeys: true,
  hasPersonalCredential: true,
  keyHint: "••••7Q4z",
  status: "unverified",
  setAt: "2026-09-30T08:15:00.000Z",
};
const EMPTY_SLOT = {
  provider: "openrouter",
  allowUserKeys: true,
  hasPersonalCredential: false,
  keyHint: null,
  status: null,
  setAt: null,
};

describe("the page", () => {
  it("reads only the signed-in member's own keys", async () => {
    await renderPage([]);
    expect(callAction).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { kind: "human", userId: "user-1" } }),
      "ai.readOwnCredentialStatus",
      {},
    );
  });

  it("shows a stored key by its state, its last four and its date, and never pre-fills a field", async () => {
    const html = await renderPage([STORED, EMPTY_SLOT]);
    expect(html).toContain("Your AI keys");
    expect(html).toContain("Anthropic");
    expect(html).toContain("Stored");
    expect(html).toContain("••••7Q4z");
    expect(html).toContain("Not tried yet");
    expect(html).toContain("Stored on 2026-09-30");
    // A stored key offers Replace and Remove; an empty slot offers Store.
    expect(html).toContain("Replace");
    expect(html).toContain("Remove my key");
    expect(html).toContain("OpenRouter");
    expect(html).toContain("Not stored");
    expect(html).toContain("Paste your key for OpenRouter.");
    // The field is a password field, empty, twice: one per provider.
    const fields = html.match(/<input[^>]*name="apiKey"[^>]*>/g) ?? [];
    expect(fields).toHaveLength(2);
    for (const field of fields) {
      expect(field).toContain('type="password"');
      expect(field).not.toMatch(/value=/);
    }
  });

  it("says when the workspace takes no personal keys, and who can change that", async () => {
    const html = await renderPage([]);
    expect(html).toContain('data-testid="personal-keys-empty"');
    expect(html).toContain(
      "Your workspace does not take a personal key for any provider.",
    );
    expect(html).not.toContain('name="apiKey"');
  });

  it("shows a member below edit their slots and why there is no form", async () => {
    accessLevel.mockResolvedValue(ACCESS_LEVELS.view);
    const html = await renderPage([STORED]);
    expect(html).toContain('data-testid="personal-keys-denied"');
    expect(html).toContain(
      "Your access in this workspace lets you see your keys but not store or remove one.",
    );
    expect(html).toContain("••••7Q4z");
    expect(html).not.toContain('name="apiKey"');
    expect(html).not.toContain("Remove my key");
  });
});

describe("where it lives", () => {
  it("is in every member's account menu, not behind administration", () => {
    const account = navigationFor("sidebar", ACCESS_LEVELS.view).filter(
      (item) => item.group === "account",
    );
    expect(account.map((item) => item.href)).toContain("/account/ai");
  });

  it("is where the AI console sends an administrator who allows personal keys", () => {
    const aiConsole = readScreen(
      fileURLToPath(new URL("../app/admin/ai/page.tsx", import.meta.url)),
    );
    expect(aiConsole).toContain(
      "Each member stores their own under Your AI keys, in their account.",
    );
  });

  it("has loading and error states, from the account segment it sits in", () => {
    for (const file of ["loading.tsx", "error.tsx"]) {
      expect(
        existsSync(
          fileURLToPath(new URL(`../app/account/${file}`, import.meta.url)),
        ),
        file,
      ).toBe(true);
    }
  });
});
