import { CATALOGUES, TranslationsProvider, translate } from "@openokr/ui";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Plan 0.8.0 S2: where a sign-up's confirmation link lands. It used to land on
// the home page, which sent a person with no session to sign in with no word
// that anything had worked. S3 adds the form that asks for a new link.

const core = vi.hoisted(() => ({
  EMAIL_VERIFICATION_LINK_SECONDS: 24 * 60 * 60,
  resolveSupportEmail: vi.fn(),
}));

vi.mock("@openokr/core", () => core);
vi.mock("../lib/auth-client", () => ({
  authClient: { sendVerificationEmail: vi.fn() },
}));
vi.mock("../lib/auth", () => ({ getPool: () => ({}) }));
vi.mock("../lib/instance-name", () => ({
  getInstanceName: async () => "OKRGoal",
}));
vi.mock("../lib/page-title.ts", () => ({ pageTitle: () => async () => ({}) }));
vi.mock("../lib/translations", () => ({
  getTranslations: async () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      translate(CATALOGUES.en, key, values),
  }),
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

const { default: EmailConfirmedPage } = await import(
  "../app/(auth)/email-confirmed/page"
);

// The form that asks for a new link is a client component, which reads the
// catalogue from the provider the root layout puts around every page.
const render = async (error?: string) =>
  renderToString(
    <TranslationsProvider locale="en">
      {
        (await EmailConfirmedPage({
          searchParams: Promise.resolve(error ? { error } : {}),
        })) as ReactNode
      }
    </TranslationsProvider>,
  );

describe("/email-confirmed", () => {
  beforeEach(() => {
    core.resolveSupportEmail.mockResolvedValue("support@okrgoal.example");
  });

  it("welcomes by the instance's name and offers the sign-in", async () => {
    const html = await render();
    expect(html).toContain("Welcome to OKRGoal");
    expect(html).toContain("Your email is confirmed");
    expect(html).toContain('href="/sign-in"');
    expect(html).toContain('data-testid="email-confirmed"');
  });

  it("says an expired link has expired, how long links last, and offers a new one", async () => {
    const html = await render("TOKEN_EXPIRED");
    expect(html).toContain("This link has expired");
    expect(html).toContain("works for 24 hours");
    expect(html).toContain("Type your email and we will send a new one.");
    expect(html).toContain('name="email"');
    expect(html).toContain("Send a new link");
    expect(html).toContain("Still stuck? Write to");
    expect(html).toContain("mailto:support@okrgoal.example");
  });

  it("calls any other error a link that is not valid, with the same form", async () => {
    for (const error of ["INVALID_TOKEN", "USER_NOT_FOUND", "anything"]) {
      const html = await render(error);
      expect(html).toContain("This link is not valid");
      expect(html).toContain("It may have been copied only in part.");
      // A newer link replaces nothing, so the page does not say it might.
      expect(html).not.toContain("newer link");
      expect(html).toContain("Send a new link");
      expect(html).not.toContain("Welcome to");
    }
  });

  it("sends somebody to whoever runs it when no support address is set", async () => {
    core.resolveSupportEmail.mockResolvedValue(null);
    const html = await render("TOKEN_EXPIRED");
    expect(html).toContain("Still stuck? Ask whoever runs this instance.");
    expect(html).not.toContain("mailto:");
  });
});
