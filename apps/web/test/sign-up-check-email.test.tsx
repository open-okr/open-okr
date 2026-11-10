// @vitest-environment jsdom
import { TranslationsProvider } from "@openokr/ui";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Plan 0.8.0 S1 and S2: after sign-up on an instance that must confirm the
// address, the form says to check the email rather than bouncing the person
// to sign in, and the link in the mail lands on /email-confirmed. S3 adds
// "Send the link again" to the card.

const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  sendVerificationEmail: vi.fn(),
}));
const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("../lib/auth-client", () => ({
  authClient: {
    signUp: { email: auth.signUp },
    sendVerificationEmail: auth.sendVerificationEmail,
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { SignUpForm } = await import("../app/(auth)/sign-up/sign-up-form");

let host: HTMLDivElement;
let root: Root;

const render = async () => {
  await act(async () => {
    root.render(
      <TranslationsProvider locale="en">
        <SignUpForm
          legal={{ termsUrl: null, privacyUrl: null }}
          linkHours={1}
        />
      </TranslationsProvider>,
    );
  });
};

const fill = (name: string, value: string) => {
  const input = host.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!input) {
    throw new Error(`no input named ${name}`);
  }
  input.value = value;
};

const submit = async () => {
  fill("name", "Priya Shah");
  fill("email", "priya@northwind.example");
  fill("password", "a long enough password");
  const form = host.querySelector("form");
  await act(async () => {
    form?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
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

describe("sign-up", () => {
  test("names /email-confirmed as where the link lands", async () => {
    auth.signUp.mockResolvedValue({
      data: { token: "t", user: {} },
      error: null,
    });
    await render();
    await submit();
    expect(auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ callbackURL: "/email-confirmed" }),
    );
  });

  test("says to check the email when the account waits for its link", async () => {
    auth.signUp.mockResolvedValue({
      data: { token: null, user: {} },
      error: null,
    });
    await render();
    await submit();
    const card = host.querySelector('[data-testid="check-email"]');
    expect(card?.textContent).toContain("priya@northwind.example");
    expect(card?.textContent).toContain("one hour");
    expect(host.textContent).toContain("Check your email");
    expect(router.push).not.toHaveBeenCalled();
    // The address is shown, never put in the address bar.
    expect(window.location.search).not.toContain("priya");
  });

  test("offers the link again for the address it was sent to", async () => {
    auth.signUp.mockResolvedValue({
      data: { token: null, user: {} },
      error: null,
    });
    auth.sendVerificationEmail.mockResolvedValue({
      data: { status: true },
      error: null,
    });
    await render();
    await submit();
    const again = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Send the link again",
    );
    await act(async () => {
      again?.click();
    });
    expect(auth.sendVerificationEmail).toHaveBeenCalledWith({
      email: "priya@northwind.example",
      callbackURL: "/email-confirmed",
    });
    expect(
      host.querySelector('[data-testid="resend-answer"]')?.textContent,
    ).toContain("If priya@northwind.example has an account waiting");
  });

  test("goes on as before when there is a session", async () => {
    auth.signUp.mockResolvedValue({
      data: { token: "t", user: {} },
      error: null,
    });
    await render();
    await submit();
    expect(router.push).toHaveBeenCalledWith("/");
    expect(host.querySelector('[data-testid="check-email"]')).toBeNull();
  });

  test("shows a refusal and stays on the form", async () => {
    auth.signUp.mockResolvedValue({
      data: null,
      error: { message: "Registration is closed." },
    });
    await render();
    await submit();
    expect(host.textContent).toContain("Registration is closed.");
    expect(host.querySelector('[data-testid="check-email"]')).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });
});
