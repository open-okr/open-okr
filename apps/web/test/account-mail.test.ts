import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two account mails sent from inside a request, in the shared layout
 * (docs/design/email-templates.md). The confirmation mail moved to
 * packages/core with the relay that sends it (email-verification.md D6), and
 * its test is `packages/core/test/email-mails.test.ts`.
 *
 * The layout itself is proved in packages/core. What is proved here is the
 * wiring: the instance's name and language, both parts, and that the button
 * and the raw link carry exactly the url Better Auth handed over.
 */

let language = "en";

vi.mock("../lib/instance-name", () => ({
  getInstanceName: async () => "Northwind OKR",
}));
vi.mock("../lib/pool", () => ({ getPool: () => ({}) }));
vi.mock("@openokr/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openokr/core")>()),
  resolveInstanceDefaultLanguage: async () => language,
}));

const { resetPasswordMail, signInHeldMail } = await import(
  "../lib/account-mail"
);

const RESET =
  "https://okr.example.com/api/auth/reset-password/tok123?callbackURL=%2Freset-password";

beforeEach(() => {
  language = "en";
});

describe("the password reset mail", () => {
  it("names the instance and the address, and carries Better Auth's link in both parts", async () => {
    const mail = await resetPasswordMail("sara@example.com", RESET);
    expect(mail.subject).toBe("Reset your Northwind OKR password");
    expect(mail.html).toContain("Choose a new password");
    expect(mail.html).toContain("<b>sara@example.com</b>");
    // The button and the raw link under it, both the url as given.
    const escaped = RESET.replaceAll("&", "&amp;");
    expect(mail.html.split(`href="${escaped}"`)).toHaveLength(3);
    expect(mail.text).toContain(`Choose a new password: ${RESET}`);
    expect(mail.text).toContain("okr.example.com");
  });

  it("is written in the instance's language", async () => {
    language = "ms";
    const mail = await resetPasswordMail("sara@example.com", RESET);
    expect(mail.subject).toBe("Tetapkan semula kata laluan Northwind OKR anda");
    expect(mail.html).toContain('<html lang="ms">');
  });
});

describe("the sign-in hold mail (account-lockout.md Q2)", () => {
  const FORGOT = "https://okr.example.com/forgot-password";

  it("names the account and sends the person to ask for a reset, not to a reset itself", async () => {
    const mail = await signInHeldMail("sara@example.com", FORGOT);
    expect(mail.subject).toBe(
      "Somebody is trying to sign in to your Northwind OKR account",
    );
    expect(mail.html).toContain("<b>sara@example.com</b>");
    expect(mail.html.split(`href="${FORGOT}"`)).toHaveLength(3);
    expect(mail.text).toContain(`Choose a new password: ${FORGOT}`);
    // Nothing in it says which network or how many attempts.
    expect(mail.text).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it("is written in the instance's language", async () => {
    language = "ms";
    const mail = await signInHeldMail("sara@example.com", FORGOT);
    expect(mail.subject).toBe(
      "Seseorang cuba log masuk ke akaun Northwind OKR anda",
    );
  });
});
