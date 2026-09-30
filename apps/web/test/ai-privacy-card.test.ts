import { AI_CONTEXT_EGRESS_LEVELS as ENFORCED_LEVELS } from "@openokr/adapters";
import { CATALOGUES, TranslationsProvider, translate } from "@openokr/ui";
import { type ComponentProps, createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The privacy and egress card (AI-NATIVE-PLAN §4, completeness review M-10).
 *
 * It was three paragraphs of static text, and one of them was not true. These
 * prove the card is now a form: what it posts, what it refuses before posting,
 * and that what it shows is what is stored. The controls themselves are proved
 * where they are enforced, in `packages/adapters/test/ai-egress.test.ts`, and
 * the save and read-back against a database in
 * `packages/core/test/ai-privacy.test.ts`.
 */

const callAction = vi.fn();
const revalidatePath = vi.fn();

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
vi.mock("../lib/pool", () => ({ getPool: () => ({}) }));
vi.mock("../lib/secrets", () => ({ getKeyRing: () => ({}) }));
vi.mock("@openokr/core", async (original) => ({
  ...(await original<typeof import("@openokr/core")>()),
  callAction: (...args: unknown[]) => callAction(...args),
}));

const { AI_CONTEXT_EGRESS_LEVELS } = await import("@openokr/core");
const { savePrivacy } = await import("../app/admin/ai/actions");
const { PrivacyCard, egressStateOf } = await import(
  "../app/admin/ai/governance"
);

beforeEach(() => {
  callAction.mockReset();
  revalidatePath.mockReset();
});

const NOTHING = { ok: true, message: "" };

function submitted(
  fields: Record<string, string>,
  checked: readonly string[] = [],
): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    form.set(name, value);
  }
  // An unchecked box posts nothing at all, which is how the action reads it.
  for (const name of checked) {
    form.set(name, "on");
  }
  return form;
}

describe("the levels", () => {
  it("are the same three words where they are stored and where they are enforced", () => {
    // Core may not import the adapters package, so the list is written twice.
    // This application imports both, which makes it the place to hold them
    // together.
    expect([...AI_CONTEXT_EGRESS_LEVELS]).toEqual([...ENFORCED_LEVELS]);
  });
});

describe("saving the card", () => {
  it("posts every control, reading an unticked box as off", async () => {
    callAction.mockResolvedValue({});
    const state = await savePrivacy(
      NOTHING,
      submitted(
        {
          contextEgress: "assists",
          allowedHosts: "api.anthropic.com\nopenrouter.ai",
        },
        ["noTraining"],
      ),
    );

    expect(state).toEqual({ ok: true, message: "Saved." });
    expect(callAction).toHaveBeenCalledWith(
      expect.anything(),
      "ai.updatePrivacySettings",
      {
        contextEgress: "assists",
        redactPersonalData: false,
        noTraining: true,
        allowedHosts: ["api.anthropic.com", "openrouter.ai"],
      },
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/ai");
  });

  it("reduces a pasted address to its host, and reads commas as separators", async () => {
    callAction.mockResolvedValue({});
    await savePrivacy(
      NOTHING,
      submitted({
        contextEgress: "all",
        allowedHosts: "https://api.openai.com/v1, openrouter.ai",
      }),
    );
    expect(callAction.mock.calls[0]?.[2]).toMatchObject({
      allowedHosts: ["api.openai.com", "openrouter.ai"],
    });
  });

  it("saves an empty list, which allows any enabled provider", async () => {
    callAction.mockResolvedValue({});
    await savePrivacy(
      NOTHING,
      submitted({ contextEgress: "all", allowedHosts: "  \n " }, [
        "redactPersonalData",
      ]),
    );
    expect(callAction.mock.calls[0]?.[2]).toEqual({
      contextEgress: "all",
      redactPersonalData: true,
      noTraining: false,
      allowedHosts: [],
    });
  });

  it("refuses a host that is not one, by name, and writes nothing", async () => {
    const state = await savePrivacy(
      NOTHING,
      submitted({ contextEgress: "all", allowedHosts: "api openai!com" }),
    );
    expect(state.ok).toBe(false);
    expect(state.message).toBe(
      "openai!com is not a host name. Write the host alone, like api.openai.com, without https:// or a path.",
    );
    expect(callAction).not.toHaveBeenCalled();
  });

  it("says why the action refused, rather than appearing to do nothing", async () => {
    callAction.mockRejectedValue(new Error("No such workspace."));
    const state = await savePrivacy(
      NOTHING,
      submitted({ contextEgress: "none", allowedHosts: "" }),
    );
    expect(state).toEqual({ ok: false, message: "No such workspace." });
  });
});

/** The card as the console renders it. */
async function renderCard(
  privacy: Parameters<typeof PrivacyCard>[0]["privacy"],
  egress: Parameters<typeof PrivacyCard>[0]["egress"],
): Promise<string> {
  const card = (await PrivacyCard({ privacy, egress })) as ReactNode;
  return renderToString(
    createElement(
      TranslationsProvider,
      { locale: "en" } as ComponentProps<typeof TranslationsProvider>,
      card,
    ),
  );
}

const STORED = {
  contextEgress: "assists" as const,
  redactPersonalData: true,
  noTraining: false,
  allowedHosts: ["api.anthropic.com", "openrouter.ai"],
};

/** Whether the one input carrying this attribute is ticked. */
function ticked(html: string, attribute: string): boolean {
  const tag = html
    .split("<input")
    .slice(1)
    .map((rest) => rest.slice(0, rest.indexOf(">")))
    .find((attributes) => attributes.includes(attribute));
  if (tag === undefined) {
    throw new Error(`No input carries ${attribute}`);
  }
  return tag.includes('checked=""');
}

describe("reading the card back", () => {
  it("shows what is stored", async () => {
    const html = await renderCard(STORED, "remote");
    expect(ticked(html, 'value="assists"')).toBe(true);
    expect(ticked(html, 'value="all"')).toBe(false);
    expect(ticked(html, 'value="none"')).toBe(false);
    expect(ticked(html, 'name="redactPersonalData"')).toBe(true);
    expect(ticked(html, 'name="noTraining"')).toBe(false);
    expect(html).toContain("api.anthropic.com\nopenrouter.ai</textarea>");
  });

  it("says what each control does and where it stops", async () => {
    const html = await renderCard(STORED, "remote");
    expect(html).toContain("Names are sent as written.");
    expect(html).toContain(
      "Anthropic, OpenAI and Google take no such instruction on a request",
    );
    expect(html).toContain("never its text");
  });

  it("greys the controls out, and says why, when every tier is answered locally", async () => {
    const html = await renderCard(STORED, "local");
    expect(html).toMatch(/<fieldset disabled=""/);
    expect(html).toContain("nothing leaves your network");
  });

  it("stays editable with nothing configured, so a decision can come first", async () => {
    const html = await renderCard(STORED, "unconfigured");
    expect(html).not.toMatch(/<fieldset disabled=""/);
    expect(html).toContain("With no provider configured");
  });
});

describe("egressStateOf", () => {
  const unresolved = { provider: null };

  /** A provider row as `ai.readProviderConfig` returns one, enabled. */
  const row = (
    provider: "ollama" | "anthropic" | "openai-compatible",
    baseUrl: string | null,
    overrides: { enabled?: boolean; hasWorkspaceCredential?: boolean } = {},
  ) => ({
    provider,
    baseUrl,
    enabled: true,
    hasWorkspaceCredential: provider !== "ollama",
    ...overrides,
  });

  it("is unconfigured when no tier routes anywhere", () => {
    expect(egressStateOf([unresolved, unresolved], [])).toBe("unconfigured");
  });

  it("is local when every tier routes to a model on this machine", () => {
    expect(
      egressStateOf(
        [{ provider: "ollama" }, unresolved],
        [row("ollama", null)],
      ),
    ).toBe("local");
  });

  it("is remote when any tier routes off the network", () => {
    expect(
      egressStateOf(
        [{ provider: "ollama" }, { provider: "anthropic" }],
        [row("ollama", null), row("anthropic", null)],
      ),
    ).toBe("remote");
  });

  it("counts a name that only looks internal as remote", () => {
    expect(
      egressStateOf(
        [{ provider: "ollama" }],
        [row("ollama", "http://ollama:11434/v1")],
      ),
    ).toBe("remote");
  });

  it("counts a route with no provider row here as remote, since its address is unknown", () => {
    expect(egressStateOf([{ provider: "ollama" }], [])).toBe("remote");
  });

  it("counts a local row that is not the one a call would use as remote", () => {
    // A disabled row, or an endpoint with no key, is passed over for the
    // deployment's own key, whose address this page cannot see. Greying the
    // card out over it would say nothing leaves while something does.
    expect(
      egressStateOf(
        [{ provider: "ollama" }],
        [row("ollama", null, { enabled: false })],
      ),
    ).toBe("remote");
    expect(
      egressStateOf(
        [{ provider: "openai-compatible" }],
        [
          row("openai-compatible", "http://10.0.0.5:8000/v1", {
            hasWorkspaceCredential: false,
          }),
        ],
      ),
    ).toBe("remote");
    expect(
      egressStateOf(
        [{ provider: "openai-compatible" }],
        [row("openai-compatible", "http://10.0.0.5:8000/v1")],
      ),
    ).toBe("local");
  });
});
