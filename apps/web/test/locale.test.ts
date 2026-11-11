import { beforeEach, describe, expect, test, vi } from "vitest";

// Q-8 (plan 0.8.1, decided by Akmal on 12 November 2026): a signed-out page
// uses the browser's language when the product ships it, otherwise the
// instance's, otherwise English. Signed in, the member's then the
// workspace's, as before.

const state = vi.hoisted(() => ({
  signedIn: false,
  memberLanguage: null as string | null,
  workspaceLanguage: null as string | null,
  acceptLanguage: null as string | null,
  instanceLanguage: "en" as string | Error,
  headersFail: false,
}));

vi.mock("../lib/pool", () => ({ getPool: () => ({}) }));
vi.mock("../lib/workspace", () => ({
  requireWorkspace: async () => {
    if (!state.signedIn) {
      throw new Error("NEXT_REDIRECT");
    }
    return {
      session: { user: { id: "user-1" } },
      workspace: { workspaceId: "workspace-1", memberId: "member-1" },
    };
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => {
    if (state.headersFail) {
      throw new Error("headers() outside a request");
    }
    return new Headers(
      state.acceptLanguage === null
        ? {}
        : { "accept-language": state.acceptLanguage },
    );
  },
}));
vi.mock("@openokr/core", () => ({
  callAction: async (_context: unknown, name: string) => {
    if (name === "people.readMember") {
      return { language: state.memberLanguage };
    }
    if (name === "settings.readWorkspaceSettings") {
      return { settings: { language: state.workspaceLanguage } };
    }
    throw new Error(`Unexpected action ${name}`);
  },
  resolveInstanceDefaultLanguage: async () => {
    if (state.instanceLanguage instanceof Error) {
      throw state.instanceLanguage;
    }
    return state.instanceLanguage;
  },
}));

const { resolveLocale } = await import("../lib/locale");

beforeEach(() => {
  state.signedIn = false;
  state.memberLanguage = null;
  state.workspaceLanguage = null;
  state.acceptLanguage = null;
  state.instanceLanguage = "en";
  state.headersFail = false;
});

describe("a signed-out page", () => {
  test("a Malay browser on an English instance reads Malay", async () => {
    state.acceptLanguage = "ms-MY,ms;q=0.9,en;q=0.8";
    expect(await resolveLocale()).toBe("ms");
  });

  test("an English browser on a Malay instance reads English", async () => {
    state.acceptLanguage = "en-GB,en;q=0.9";
    state.instanceLanguage = "ms";
    expect(await resolveLocale()).toBe("en");
  });

  test("a browser language the product does not ship falls to the instance's", async () => {
    state.acceptLanguage = "fr-FR,fr;q=0.9";
    state.instanceLanguage = "ms";
    expect(await resolveLocale()).toBe("ms");
  });

  test("no header falls to the instance's language", async () => {
    state.instanceLanguage = "ms";
    expect(await resolveLocale()).toBe("ms");
  });

  test("an instance language the product does not ship falls to English", async () => {
    state.acceptLanguage = "fr";
    state.instanceLanguage = "de";
    expect(await resolveLocale()).toBe("en");
  });

  test("never throws: no headers and no instance setting is English", async () => {
    state.headersFail = true;
    state.instanceLanguage = new Error("database down");
    expect(await resolveLocale()).toBe("en");
  });
});

describe("a signed-in page, unchanged", () => {
  test("the member's own language wins over the browser's", async () => {
    state.signedIn = true;
    state.memberLanguage = "en";
    state.acceptLanguage = "ms";
    expect(await resolveLocale()).toBe("en");
  });

  test("then the workspace's", async () => {
    state.signedIn = true;
    state.workspaceLanguage = "ms";
    state.acceptLanguage = "en";
    expect(await resolveLocale()).toBe("ms");
  });

  test("then English, whatever the browser says", async () => {
    state.signedIn = true;
    state.acceptLanguage = "ms";
    state.instanceLanguage = "ms";
    expect(await resolveLocale()).toBe("en");
  });
});
