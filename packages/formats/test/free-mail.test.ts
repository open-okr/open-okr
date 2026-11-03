import { describe, expect, it } from "vitest";
import {
  FREE_MAIL_DOMAINS,
  isFreeMailAddress,
  isFreeMailDomain,
} from "../src/index.ts";

describe("free mail providers (docs/design/registration-policy.md §2.1)", () => {
  it("knows the common providers", () => {
    for (const domain of [
      "gmail.com",
      "yahoo.co.id",
      "outlook.com",
      "icloud.com",
    ]) {
      expect(isFreeMailDomain(domain), domain).toBe(true);
    }
  });

  it("ignores case and spaces", () => {
    expect(isFreeMailDomain(" Gmail.COM ")).toBe(true);
    expect(isFreeMailAddress("Ana@GMAIL.com")).toBe(true);
  });

  it("does not match a company domain, or a subdomain of a listed one", () => {
    expect(isFreeMailDomain("acme.com")).toBe(false);
    expect(isFreeMailDomain("mail.gmail.com")).toBe(false);
    expect(isFreeMailDomain("gmail.acme.com")).toBe(false);
    expect(isFreeMailAddress("ana@acme.co.id")).toBe(false);
  });

  it("reads the domain after the last @, and an address with none is not free", () => {
    expect(isFreeMailAddress('"a@b"@gmail.com')).toBe(true);
    expect(isFreeMailAddress("gmail.com")).toBe(false);
  });

  it("holds lower-case domains only, so a lookup never misses on case", () => {
    for (const domain of FREE_MAIL_DOMAINS) {
      expect(domain).toBe(domain.toLowerCase());
    }
  });
});
