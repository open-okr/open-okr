// @vitest-environment jsdom
import { TranslationsProvider } from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * The setup wizard shows a refused sign-up as the refusal
 * (docs/design/registration-policy.md §10 D19, plan 0.8.0 H3).
 *
 * On 0.6.0 the wizard fell through to signing in after a sign-up the policy
 * had refused, and the person was told "Invalid email or password" for an
 * account that was never created. It falls through only when the sign-up
 * succeeded without a session, which is a verified-address instance's answer.
 * This pins that, so a change to the fall-through cannot bring the dead end
 * back.
 */

const auth = vi.hoisted(() => ({ signUp: vi.fn(), signIn: vi.fn() }));
const finishSetup = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("../lib/auth-client", () => ({
  authClient: {
    signUp: { email: auth.signUp },
    signIn: { email: auth.signIn },
  },
}));
vi.mock("../app/setup/account/actions", () => ({ finishSetup }));
vi.mock("../lib/instance-name-context", () => ({
  useInstanceName: () => "OpenOKR",
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { SetupAccountForm } = await import(
  "../app/setup/account/setup-account-form"
);

const REFUSAL =
  "This instance is invitation-only. Ask a workspace admin to invite you.";

let host: HTMLDivElement;
let root: Root;

const submit = async () => {
  await act(async () => {
    root.render(
      <TranslationsProvider locale="en">
        <SetupAccountForm />
      </TranslationsProvider>,
    );
  });
  for (const [name, value] of [
    ["name", "Ada Lovelace"],
    ["email", "ada@example.com"],
    ["password", "a long enough password"],
  ] as const) {
    const input = host.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (!input) {
      throw new Error(`no input named ${name}`);
    }
    input.value = value;
  }
  await act(async () => {
    host
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("the setup wizard's sign-up", () => {
  test("shows a refused sign-up as itself and never tries to sign in", async () => {
    auth.signUp.mockResolvedValue({
      data: null,
      error: { status: 403, message: REFUSAL },
    });
    await submit();

    expect(auth.signIn).not.toHaveBeenCalled();
    expect(finishSetup).not.toHaveBeenCalled();
    expect(host.textContent).toContain(REFUSAL);
    expect(host.textContent).not.toContain("Invalid email or password");
  });

  test("signs in when the account was made without a session, and finishes setup", async () => {
    auth.signUp.mockResolvedValue({
      data: { token: null, user: {} },
      error: null,
    });
    auth.signIn.mockResolvedValue({ data: {}, error: null });
    finishSetup.mockResolvedValue({ ok: true });
    await submit();

    expect(auth.signIn).toHaveBeenCalledWith({
      email: "ada@example.com",
      password: "a long enough password",
    });
    expect(finishSetup).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith("/");
  });

  test("finishes setup straight away when the sign-up gave a session", async () => {
    auth.signUp.mockResolvedValue({
      data: { token: "t", user: {} },
      error: null,
    });
    finishSetup.mockResolvedValue({ ok: true });
    await submit();

    expect(auth.signIn).not.toHaveBeenCalled();
    expect(finishSetup).toHaveBeenCalled();
  });
});
