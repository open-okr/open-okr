import { fileURLToPath } from "node:url";
import { CATALOGUES, translate } from "@openokr/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readScreen } from "./screen-text.ts";

/**
 * The single sign-on screen changes, switches and removes a connection.
 *
 * `/admin/sso` added connections and did nothing else, so correcting one meant
 * SQL on `sso_connections`. These prove the screen's half: what each control
 * sends, that the secret goes one way, that this process looks again after a
 * save, and that a refusal lands on its field. The actions themselves are
 * proved against a database in `packages/core/test/sso-connection-writes.test.ts`,
 * and the browser half in `e2e/s36i-saml-provider.spec.ts`.
 */

const SECRET = "a-new-client-secret-9Xq";
const BASE_URL = "https://okr.example";

const callAction = vi.fn();
const revalidatePath = vi.fn();
const expireSSOProviders = vi.fn();

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
vi.mock("../lib/pool", () => ({ getPool: () => "the pool" }));
vi.mock("../lib/secrets", () => ({ getKeyRing: () => "the ring" }));
vi.mock("../lib/sso", () => ({
  expireSSOProviders: () => expireSSOProviders(),
}));
vi.mock("@openokr/config", async (original) => ({
  ...(await original<typeof import("@openokr/config")>()),
  loadEnv: () => ({ BETTER_AUTH_URL: BASE_URL }),
}));
vi.mock("@openokr/core", async (original) => ({
  ...(await original<typeof import("@openokr/core")>()),
  callAction: (...args: unknown[]) => callAction(...args),
}));

const { OperationError, SSOConnectionRejected } = await import("@openokr/core");
const {
  removeSSOConnectionAction,
  setSSOConnectionEnabledAction,
  updateSSOConnectionAction,
} = await import("../app/admin/sso/actions");

const ID = "0f5f6c2e-8a0c-4d7e-9f1a-2b3c4d5e6f70";

const oidcEdit = {
  id: ID,
  kind: "oidc" as const,
  displayName: "Sign in with Okta",
  emailDomains: "acme.example",
  enforce: false,
  clientId: "client-two",
  clientSecret: "",
  discoveryUrl: "https://idp.example/.well-known/openid-configuration",
  authorizationUrl: "",
  tokenUrl: "",
  userInfoUrl: "",
  scopes: "openid email profile",
  // What the form reads from fields that are not on screen.
  samlEntryPoint: "",
  samlIssuer: "",
  samlCertificate: "",
  samlAudience: "",
};

beforeEach(() => {
  callAction.mockReset();
  revalidatePath.mockReset();
  expireSSOProviders.mockReset();
});

describe("saving an edit", () => {
  it("sends the connection's own protocol fields, as the signed-in member, with the ring and the address", async () => {
    callAction.mockResolvedValue({});

    const result = await updateSSOConnectionAction(oidcEdit);

    expect(result).toEqual({ ok: true });
    const [context, action, input] = callAction.mock.calls[0] as [
      {
        actor: { userId: string };
        workspaceId: string;
        ring: unknown;
        baseUrl: string;
      },
      string,
      Record<string, unknown>,
    ];
    expect(action).toBe("sso.updateConnection");
    expect(context.actor.userId).toBe("user-1");
    expect(context.workspaceId).toBe("workspace-1");
    expect(context.ring).toBe("the ring");
    expect(context.baseUrl).toBe(BASE_URL);
    // The action refuses a field of the other protocol rather than dropping
    // it, so the form must not send them.
    expect(Object.keys(input)).not.toContain("samlCertificate");
    expect(input.clientId).toBe("client-two");
  });

  it("leaves a blank secret out, which keeps the stored one", async () => {
    callAction.mockResolvedValue({});
    await updateSSOConnectionAction({ ...oidcEdit, clientSecret: "   " });
    const input = callAction.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(Object.keys(input)).not.toContain("clientSecret");
  });

  it("passes a new secret through, and never hands it back", async () => {
    callAction.mockResolvedValue({});
    const result = await updateSSOConnectionAction({
      ...oidcEdit,
      clientSecret: SECRET,
    });
    const input = callAction.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(input.clientSecret).toBe(SECRET);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("sends a SAML connection's fields and none of OIDC's", async () => {
    callAction.mockResolvedValue({});
    await updateSSOConnectionAction({
      ...oidcEdit,
      kind: "saml",
      samlEntryPoint: "https://idp.example/sso",
      samlIssuer: "https://idp.example/entity",
      samlCertificate: "-----BEGIN CERTIFICATE-----",
    });
    const input = callAction.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(input.samlEntryPoint).toBe("https://idp.example/sso");
    for (const field of [
      "clientId",
      "clientSecret",
      "discoveryUrl",
      "scopes",
    ]) {
      expect(Object.keys(input)).not.toContain(field);
    }
  });

  it("has this process look again at its next sign-in, and refreshes the screen", async () => {
    callAction.mockResolvedValue({});
    await updateSSOConnectionAction(oidcEdit);
    expect(expireSSOProviders).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/admin/sso");
  });

  it("puts a refusal on the field it is about, and changes nothing", async () => {
    callAction.mockRejectedValue(
      new SSOConnectionRejected({
        field: "emailDomains",
        message: "List at least one domain, or do not enforce.",
      }),
    );

    const result = await updateSSOConnectionAction({
      ...oidcEdit,
      enforce: true,
      emailDomains: "",
    });

    expect(result).toEqual({
      ok: false,
      field: "emailDomains",
      message: "List at least one domain, or do not enforce.",
    });
    expect(expireSSOProviders).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("says nothing changed when something failed that is not a refusal", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    callAction.mockRejectedValue(new Error("connection terminated"));

    const result = await updateSSOConnectionAction(oidcEdit);

    expect(result).toEqual({
      ok: false,
      message: "That did not work, and nothing changed.",
    });
    expect(JSON.stringify(result)).not.toContain("connection terminated");
    error.mockRestore();
  });
});

describe("turning off and removing", () => {
  it("switches through sso.setConnectionEnabled and looks again", async () => {
    callAction.mockResolvedValue({});
    const result = await setSSOConnectionEnabledAction(ID, false);
    expect(result).toEqual({ ok: true });
    expect(callAction.mock.calls[0]?.[1]).toBe("sso.setConnectionEnabled");
    expect(callAction.mock.calls[0]?.[2]).toEqual({ id: ID, enabled: false });
    expect(expireSSOProviders).toHaveBeenCalledTimes(1);
  });

  it("removes through sso.removeConnection and looks again", async () => {
    callAction.mockResolvedValue({ id: ID });
    const result = await removeSSOConnectionAction(ID);
    expect(result).toEqual({ ok: true });
    expect(callAction.mock.calls[0]?.[1]).toBe("sso.removeConnection");
    expect(callAction.mock.calls[0]?.[2]).toEqual({ id: ID });
    expect(expireSSOProviders).toHaveBeenCalledTimes(1);
  });

  it("answers another workspace's connection as the instance does", async () => {
    callAction.mockRejectedValue(
      new OperationError(
        "not_found",
        "No such single sign-on connection in this workspace.",
      ),
    );
    const result = await removeSSOConnectionAction(ID);
    expect(result).toEqual({
      ok: false,
      message: "No such single sign-on connection in this workspace.",
    });
    expect(expireSSOProviders).not.toHaveBeenCalled();
  });
});

describe("the screen", () => {
  const read = (file: string) =>
    readScreen(
      fileURLToPath(new URL(`../app/admin/sso/${file}`, import.meta.url)),
    );
  const page = read("page.tsx");
  const form = read("sso-form.tsx");
  const controls = read("connection-controls.tsx");

  /** One field's element in the form's source, from its name to its end. */
  const element = (name: string): string => {
    const start = form.indexOf(`name="${name}"`);
    expect(start, `${name} is not in the form`).toBeGreaterThan(-1);
    return form.slice(start, form.indexOf("/>", start));
  };

  it("lists through the registry, under this workspace's own floor", () => {
    // Completeness review L-21: the instance-wide list the sign-in page uses
    // showed one workspace's administrator every other workspace's providers.
    expect(page).toContain('"sso.listConnections"');
    expect(page).not.toContain("listSSOProviders");
  });

  it("gives every connection Edit, Turn off or on, and Remove", () => {
    expect(page).toContain("<ConnectionControls");
    expect(controls).toContain("Edit");
    expect(controls).toContain("Turn off");
    expect(controls).toContain("Turn on");
    expect(controls).toContain("Remove");
  });

  it("never fills the client secret in, and blank keeps it", () => {
    const secret = element("clientSecret");
    expect(secret).toContain('type="password"');
    // A field filled with the stored secret "so you can check it" would be a
    // screen that displays a client secret.
    expect(secret).not.toContain("defaultValue");
    expect(secret).toContain("required={!editing}");
    expect(secret).toContain("Leave blank to keep the current secret");
  });

  it("holds the provider ID still on an edit, and says why", () => {
    expect(element("providerId")).toContain("readOnly={editing}");
    expect(form).toContain("It is part of the callback address");
  });

  it("asks before removing, and names what enforcement gives back", () => {
    expect(controls).toContain('"confirmRemove"');
    expect(controls).toContain(
      "admin.sso.connectionControls.enforcedDomainsGoBack",
    );
    expect(
      translate(
        CATALOGUES.en,
        "admin.sso.connectionControls.enforcedDomainsGoBack",
        { domains: "acme.example" },
      ),
    ).toBe(
      "It is enforced for acme.example, so people on those domains will sign in with a password again.",
    );
  });

  it("says a change takes effect at the next sign-in, with no restart", () => {
    expect(page).toContain(
      "turning a connection off and removing one all take effect at the next sign-in, within a few seconds, with no restart",
    );
  });
});
