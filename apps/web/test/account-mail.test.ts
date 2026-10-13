import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two account mails in the shared layout (docs/design/email-templates.md).
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

const { resetPasswordMail, verifyEmailMail } = await import(
  "../lib/account-mail"
);

const RESET =
  "https://okr.example.com/api/auth/reset-password/tok123?callbackURL=%2Freset-password";
const VERIFY =
  "https://okr.example.com/api/auth/verify-email?token=tok456&callbackURL=%2F";

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

describe("the confirmation mail", () => {
  it("names the instance in the subject and carries the confirmation link", async () => {
    const mail = await verifyEmailMail("amara@example.com", VERIFY);
    expect(mail.subject).toBe("Confirm your email address for Northwind OKR");
    expect(mail.html).toContain("Confirm email");
    expect(mail.text).toContain(`Confirm email: ${VERIFY}`);
  });
});
