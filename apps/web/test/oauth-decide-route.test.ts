import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The consent route's two guards (H-A): a post another site caused is a 403,
 * and a refusal is only ever sent to an address the client registered.
 * The core checks are mocked, since what is under test is what the route does
 * with their answers. The registry itself is covered in packages/core.
 */

const checkMock = vi.fn();
const approveMock = vi.fn();

vi.mock("@openokr/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openokr/core")>()),
  checkAuthoriseRequestFor: checkMock,
  approveAuthorisationForMember: approveMock,
}));
vi.mock("../lib/pool", () => ({ getPool: () => ({}) }));
vi.mock("../lib/issuer", () => ({
  instanceIssuer: () => "https://okr.example.test",
}));
vi.mock("../lib/workspace", () => ({
  requireWorkspace: async () => ({
    session: { user: { id: "u-1" } },
    workspace: { workspaceId: "w-1" },
    memberships: [{ workspaceId: "w-1" }],
  }),
}));

beforeEach(() => {
  checkMock.mockReset();
  approveMock.mockReset();
});

const post = (fields: Record<string, string>, origin?: string) => {
  const body = new URLSearchParams({
    clientId: "c-1",
    redirectUri: "https://client.example/callback",
    state: "s-1",
    codeChallenge: "abc",
    ...fields,
  });
  return new Request("https://okr.example.test/oauth/authorize/decide", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(origin ? { origin } : {}),
    },
    body,
  });
};

const run = async (request: Request) => {
  const { POST } = await import("../app/oauth/authorize/decide/route");
  // NextRequest adds `nextUrl`, which the route reads for the screen address.
  return POST(
    Object.assign(request, { nextUrl: new URL(request.url) }) as never,
  );
};

describe("the consent route", () => {
  it("refuses a post another site caused, on both answers", async () => {
    for (const approve of ["yes", "no"]) {
      const response = await run(post({ approve }, "https://evil.example"));
      expect(response.status).toBe(403);
    }
    expect(checkMock).not.toHaveBeenCalled();
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("sends a refusal to a registered address", async () => {
    checkMock.mockResolvedValue({
      kind: "ok",
      clientRowId: "r",
      clientName: "n",
      scopes: ["read"],
    });
    const response = await run(
      post({ approve: "no" }, "https://okr.example.test"),
    );
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location") as string);
    expect(location.origin).toBe("https://client.example");
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("s-1");
  });

  it("does not redirect a refusal to an unregistered address", async () => {
    checkMock.mockResolvedValue({
      kind: "refused",
      refusal: { kind: "show", message: "not registered" },
    });
    const response = await run(
      post(
        { approve: "no", redirectUri: "https://attacker.example/steal" },
        "https://okr.example.test",
      ),
    );
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location") as string);
    expect(location.origin).toBe("https://okr.example.test");
    expect(location.pathname).toBe("/oauth/authorize");
    expect(location.searchParams.get("error_message")).toBe("not registered");
  });

  it("still answers a registered address when the rest of the request is wrong", async () => {
    checkMock.mockResolvedValue({
      kind: "refused",
      refusal: {
        kind: "redirect",
        error: "invalid_request",
        description: "A code_challenge is required.",
      },
    });
    const response = await run(
      post({ approve: "no" }, "https://okr.example.test"),
    );
    expect(new URL(response.headers.get("location") as string).origin).toBe(
      "https://client.example",
    );
  });
});
