// @vitest-environment jsdom
import { OperationError } from "@openokr/core";
import {
  CATALOGUES,
  TextInput,
  TranslationsProvider,
  translate,
} from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Admin and account, refused under the field they are about (guided-inputs
 * §4.2, plan 0.7.0 U1b): the AI console, a new role, single sign-on, an
 * invitation, an API token and the rhythm card. Billing and agent
 * connections refuse whole actions and keep the sentence.
 */

const callAction = vi.fn();

vi.mock("@openokr/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openokr/core")>()),
  callAction: (...args: unknown[]) => callAction(...args),
}));
vi.mock("@openokr/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openokr/config")>()),
  loadEnv: () => ({ BETTER_AUTH_URL: "https://okr.example" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("../lib/auth", () => ({ getPool: () => ({ pool: true }) }));
vi.mock("../lib/pool", () => ({ getPool: () => ({ pool: true }) }));
vi.mock("../lib/secrets", () => ({ getKeyRing: () => ({}) }));
vi.mock("../lib/sso", () => ({ expireSSOProviders: () => undefined }));
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
  }),
}));

const { saveBudget, saveProvider, saveTier } = await import(
  "../app/admin/ai/actions.ts"
);
const { createRoleAction, deleteRoleAction } = await import(
  "../app/admin/roles/actions.ts"
);
const { updateSSOConnectionAction } = await import(
  "../app/admin/sso/actions.ts"
);
const { createWorkspaceLinkAction } = await import(
  "../app/admin/invitations/actions.ts"
);
const { createToken } = await import("../app/account/api-tokens/actions.ts");
const { saveRhythm } = await import("../app/admin/rhythm/rhythm-actions.ts");
const { AIForm } = await import("../app/admin/ai/ai-form.tsx");

const en = (key: string) => translate(CATALOGUES.en, key);

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

const zodError = (issues: readonly Record<string, unknown>[]) =>
  Object.assign(new Error(JSON.stringify(issues)), {
    name: "ZodError",
    issues,
  });

beforeEach(() => {
  callAction.mockReset();
  callAction.mockResolvedValue({ id: "new", token: "t", version: 2 });
});

describe("the AI console", () => {
  const NOTHING = { ok: true, message: "" };

  it("says which model or whose budget is missing, under that picker", async () => {
    expect(await saveTier(NOTHING, form({ tier: "balanced" }))).toEqual({
      ok: false,
      message: "",
      fields: { model: en("admin.ai.actions.whichModel") },
    });
    expect(await saveBudget(NOTHING, form({ owner: "nonsense" }))).toEqual({
      ok: false,
      message: "",
      fields: { owner: en("admin.ai.actions.whoseBudget") },
    });
  });

  it("puts a base URL the schema refuses under the base URL", async () => {
    callAction.mockRejectedValue(
      zodError([
        { code: "custom", path: ["baseUrl"], message: "Not a secure link." },
      ]),
    );
    expect(
      await saveProvider(
        NOTHING,
        form({ provider: "openai", baseUrl: "http://x" }),
      ),
    ).toEqual({
      ok: false,
      message: "",
      fields: { baseUrl: "Not a secure link." },
    });
  });
});

describe("a new role", () => {
  it("puts a refused name under the name, and a delete's refusal in the sentence", async () => {
    callAction.mockRejectedValue(
      new OperationError(
        "conflict",
        "A role has that name.",
        undefined,
        "name",
      ),
    );
    expect(await createRoleAction({ name: "Lead" })).toEqual({
      error: null,
      fields: { name: "A role has that name." },
    });
    callAction.mockRejectedValue(
      new OperationError("forbidden", "Somebody holds it.", undefined, "id"),
    );
    expect(await deleteRoleAction({ id: "r" })).toEqual({
      error: "Somebody holds it.",
    });
  });
});

describe("single sign-on", () => {
  it("names the field a schema refused, which used to be logged as a fault", async () => {
    callAction.mockRejectedValue(
      zodError([
        {
          code: "custom",
          path: ["discoveryUrl"],
          message: "Not a link.",
        },
      ]),
    );
    expect(
      await updateSSOConnectionAction({
        id: "c",
        kind: "oidc",
        displayName: "Okta",
        emailDomains: "northwind.example",
        enforce: false,
        discoveryUrl: "nope",
      }),
    ).toEqual({ ok: false, message: "Not a link.", field: "discoveryUrl" });
  });
});

describe("an invitation and a token", () => {
  it("puts a refused domain under the one box the domains are typed in", async () => {
    callAction.mockRejectedValue(
      zodError([
        {
          code: "custom",
          path: ["allowedDomains", 1],
          message: "Not a domain.",
        },
      ]),
    );
    expect(
      await createWorkspaceLinkAction(
        form({ allowedDomains: "northwind.example, northwind" }),
      ),
    ).toEqual({ fields: { allowedDomains: "Not a domain." } });
  });

  it("asks for a token's name under the name", async () => {
    expect(await createToken(null, form({ "scope.read": "on" }))).toEqual({
      ok: false,
      token: null,
      message: "",
      fields: { name: en("account.apiTokens.actions.giveTheTokenAName") },
    });
  });
});

describe("the rhythm card", () => {
  it("writes a schema's refusal of one parameter the way the card finds its field", async () => {
    callAction.mockRejectedValue(
      zodError([
        {
          code: "custom",
          path: ["overrides", "checkIns", "staleDays", "value"],
          message: "Between 1 and 60.",
        },
      ]),
    );
    expect(
      await saveRhythm(
        { error: null, saved: null },
        form({ "threshold:checkIns.staleDays": "400" }),
      ),
    ).toEqual({ error: "checkIns.staleDays: Between 1 and 60.", saved: null });
  });
});

describe("AIForm", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows a refused field under the field the page drew", async () => {
    const action = async () => ({
      ok: false,
      message: "",
      fields: { baseUrl: "Not a secure link." },
    });
    await act(async () => {
      root.render(
        <TranslationsProvider locale="en">
          <AIForm action={action}>
            <TextInput label="Base URL" name="baseUrl" />
          </AIForm>
        </TranslationsProvider>,
      );
    });
    await act(async () => {
      container.querySelector("form")?.requestSubmit();
    });
    const alerts = [...container.querySelectorAll('[role="alert"]')];
    expect(alerts.map((one) => one.textContent)).toEqual([
      "Not a secure link.",
    ]);
  });
});
