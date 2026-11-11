// @vitest-environment jsdom
import { TranslationsProvider } from "@openokr/ui";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Plan 0.8.0 S3 (docs/design/email-verification.md §3): "send the link
// again" on the check-your-email card, on sign-in and on the page an expired
// or broken link lands on. The answer is the same whether or not the address
// has an account, except on sign-in, where Better Auth has already said so.

const auth = vi.hoisted(() => ({ sendVerificationEmail: vi.fn() }));

vi.mock("../lib/auth-client", () => ({
  authClient: { sendVerificationEmail: auth.sendVerificationEmail },
}));
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

const { ResendForm, ResendLink } = await import("../app/(auth)/resend-link");

let host: HTMLDivElement;
let root: Root;

const render = async (node: ReactNode) => {
  await act(async () => {
    root.render(
      <TranslationsProvider locale="en">{node}</TranslationsProvider>,
    );
  });
};

const button = (name: string) =>
  [...host.querySelectorAll("button")].find(
    (element) => element.textContent === name,
  );

const press = async (name: string) => {
  const target = button(name);
  if (!target) {
    throw new Error(`no button named ${name}`);
  }
  await act(async () => {
    target.click();
  });
};

const answer = () =>
  host.querySelector('[data-testid="resend-answer"]')?.textContent ?? "";

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
  vi.useRealTimers();
});

describe("send the link again", () => {
  test("asks Better Auth for a link that lands on /email-confirmed, and answers without saying whether the address has an account", async () => {
    auth.sendVerificationEmail.mockResolvedValue({
      data: { status: true },
      error: null,
    });
    await render(
      <ResendLink
        email="priya@northwind.example"
        hours={24}
        wording="neutral"
      />,
    );
    await press("Send the link again");

    expect(auth.sendVerificationEmail).toHaveBeenCalledWith({
      email: "priya@northwind.example",
      callbackURL: "/email-confirmed",
    });
    expect(answer()).toBe(
      "If priya@northwind.example has an account waiting to be confirmed, a new link is on its way. It works for 24 hours.",
    );
    expect(host.querySelector("strong")?.textContent).toBe(
      "priya@northwind.example",
    );
    // The button is replaced by the answer.
    expect(button("Send the link again")).toBeUndefined();
  });

  test("says it directly on sign-in, where the password already matched", async () => {
    auth.sendVerificationEmail.mockResolvedValue({
      data: { status: true },
      error: null,
    });
    await render(
      <ResendLink
        email="priya@northwind.example"
        hours={24}
        wording="direct"
      />,
    );
    await press("Send the link again");
    expect(answer()).toBe(
      "A new link is on its way to priya@northwind.example. It works for 24 hours.",
    );
  });

  test("brings the button back a minute later", async () => {
    vi.useFakeTimers();
    auth.sendVerificationEmail.mockResolvedValue({
      data: { status: true },
      error: null,
    });
    await render(
      <ResendLink
        email="priya@northwind.example"
        hours={24}
        wording="neutral"
      />,
    );
    await press("Send the link again");
    expect(button("Send the link again")).toBeUndefined();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(button("Send the link again")).toBeDefined();
  });

  test.each([
    [30, "Try again in 1 minute."],
    [7 * 60, "Try again in 7 minutes."],
    [60 * 60, "Try again in 1 hour."],
    [5 * 60 * 60 + 10, "Try again in 6 hours."],
  ])(
    "says how long to wait when the address is held for %i seconds",
    async (seconds, wait) => {
      auth.sendVerificationEmail.mockResolvedValue({
        data: null,
        error: {
          status: 429,
          code: "VERIFICATION_RESEND_HELD",
          retryAfterSeconds: seconds,
        },
      });
      await render(
        <ResendLink
          email="priya@northwind.example"
          hours={24}
          wording="neutral"
        />,
      );
      await press("Send the link again");
      expect(answer()).toBe(
        `Too many links have been asked for this address. ${wait}`,
      );
    },
  );

  test("gives the limiter's words when the network is held", async () => {
    auth.sendVerificationEmail.mockResolvedValue({
      data: null,
      error: { status: 429 },
    });
    await render(
      <ResendLink
        email="priya@northwind.example"
        hours={24}
        wording="neutral"
      />,
    );
    await press("Send the link again");
    expect(answer()).toBe("Too many attempts. Wait a minute and try again.");
  });

  test("says anything else did not work, and keeps the button", async () => {
    auth.sendVerificationEmail.mockRejectedValue(new Error("offline"));
    await render(
      <ResendLink
        email="priya@northwind.example"
        hours={24}
        wording="neutral"
      />,
    );
    await press("Send the link again");
    expect(answer()).toBe("That did not work. Try again in a moment.");
    expect(button("Send the link again")).toBeDefined();
  });
});

describe("the form on an expired or broken link's page", () => {
  test("sends a link to the address typed, then offers the sign-in", async () => {
    auth.sendVerificationEmail.mockResolvedValue({
      data: { status: true },
      error: null,
    });
    await render(<ResendForm hours={24} />);
    const field = host.querySelector<HTMLInputElement>('input[name="email"]');
    if (!field) {
      throw new Error("no email field");
    }
    field.value = "amara@example.com";
    const form = host.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(auth.sendVerificationEmail).toHaveBeenCalledWith({
      email: "amara@example.com",
      callbackURL: "/email-confirmed",
    });
    expect(answer()).toContain(
      "If amara@example.com has an account waiting to be confirmed",
    );
    expect(host.textContent).toContain("Already confirmed? Sign in.");
    expect(host.querySelector('a[href="/sign-in"]')).not.toBeNull();
  });
});
