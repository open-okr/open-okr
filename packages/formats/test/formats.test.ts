import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DEVICE_CODE_ALPHABET,
  DEVICE_USER_CODE_GROUPS,
  DOMAIN_PATTERN,
  EMAIL_PATTERN,
  formatDeviceUserCode,
  HEX_COLOUR_HTML_PATTERN,
  HEX_COLOUR_PATTERN,
  isDomain,
  isEmailAddress,
  isHexColour,
  isKnownTimezone,
  isListedTimezone,
  isLocalDate,
  LOCAL_DATE_PATTERN,
  listTimezones,
} from "../src/index.ts";

/**
 * The format rules the browser and the server share (docs/design/
 * guided-inputs.md §4.1).
 *
 * Each rule is the one `packages/core` already enforced, moved here unchanged,
 * so a field can say before a save what the server would refuse after it.
 */

describe("an email address", () => {
  it("is zod's own rule, so the server's schemas and this agree", () => {
    // `z.email()` and `.email()` use this pattern by default. If zod changes
    // it, this fails rather than letting the browser and the server drift.
    expect(EMAIL_PATTERN.source).toBe(z.regexes.email.source);
    expect(EMAIL_PATTERN.flags).toBe(z.regexes.email.flags);
  });

  it.each([
    "priya@northwind.example",
    "first.last+okrs@mail.northwind.example",
    "o'brien@northwind.example",
  ])("accepts %s", (address) => {
    expect(isEmailAddress(address)).toBe(true);
  });

  it.each([
    // The browser's own `type="email"` accepts this one. The server does not.
    "priya@northwind",
    "priya",
    "@northwind.example",
    "priya@@northwind.example",
    "priya@northwind..example",
    // Callers trim first, as the schemas do.
    " priya@northwind.example",
  ])("refuses %j", (address) => {
    expect(isEmailAddress(address)).toBe(false);
  });
});

describe("a domain", () => {
  it.each([
    "northwind.example",
    "mail.northwind.example",
    "xn--bcher-kva.example",
  ])("accepts %s", (domain) => {
    expect(isDomain(domain)).toBe(true);
  });

  it.each([
    "priya@northwind.example",
    "https://northwind.example",
    "northwind",
    "-northwind.example",
    "northwind-.example",
    // Callers lower-case first, as the schema does.
    "Northwind.Example",
  ])("refuses %j", (domain) => {
    expect(isDomain(domain)).toBe(false);
  });

  it("is the pattern the schemas apply", () => {
    expect(DOMAIN_PATTERN.test("northwind.example")).toBe(true);
  });
});

describe("a local date", () => {
  it("accepts a calendar date written YYYY-MM-DD", () => {
    expect(isLocalDate("2026-10-08")).toBe(true);
    expect(LOCAL_DATE_PATTERN.test("2027-01-04")).toBe(true);
  });

  it.each(["2026-1-8", "08/10/2026", "2026-10-08T09:00", ""])(
    "refuses %j",
    (value) => {
      expect(isLocalDate(value)).toBe(false);
    },
  );
});

describe("a hex colour", () => {
  it.each(["#336699", "#AbCdEf"])("accepts %s", (colour) => {
    expect(isHexColour(colour)).toBe(true);
  });

  it.each(["336699", "#369", "#33669g", "#3366990"])("refuses %j", (colour) => {
    expect(isHexColour(colour)).toBe(false);
  });

  it("reads the same in an HTML pattern attribute as in the regex", () => {
    // A `pattern` attribute is anchored by the browser and compiled with the
    // `v` flag, so the attribute and the regex are one rule written twice.
    const attribute = new RegExp(`^(?:${HEX_COLOUR_HTML_PATTERN})$`, "v");
    for (const value of ["#336699", "#AbCdEf", "336699", "#369", "#33669g"]) {
      expect(attribute.test(value)).toBe(HEX_COLOUR_PATTERN.test(value));
    }
  });
});

describe("a timezone", () => {
  it.each(["Asia/Kuala_Lumpur", "Europe/London", "UTC"])(
    "accepts %s, which the runtime knows",
    (timezone) => {
      expect(isKnownTimezone(timezone)).toBe(true);
    },
  );

  it.each(["Mars/Olympus_Mons", "", "Asia/Nowhere"])(
    "refuses %j",
    (timezone) => {
      expect(isKnownTimezone(timezone)).toBe(false);
    },
  );
});

describe("a terminal login code", () => {
  it("leaves out the characters a person could mistype off a screen", () => {
    expect(DEVICE_CODE_ALPHABET).toHaveLength(31);
    for (const confusable of ["0", "O", "1", "I", "L"]) {
      expect(DEVICE_CODE_ALPHABET).not.toContain(confusable);
    }
  });

  it("is written as two groups of four with a hyphen", () => {
    expect(DEVICE_USER_CODE_GROUPS).toEqual([4, 4]);
    expect(formatDeviceUserCode("ABCDEFGH")).toBe("ABCD-EFGH");
  });
});

describe("the timezone list", () => {
  it("is the runtime's own list with UTC added, which the runtime leaves out", () => {
    const zones = listTimezones();
    expect(zones[0]).toBe("UTC");
    expect(zones).toContain("Asia/Kuala_Lumpur");
    expect(zones).toContain("America/New_York");
    expect(new Set(zones).size).toBe(zones.length);
  });

  it.each(["UTC", "Asia/Kuala_Lumpur", "Europe/London"])("lists %s", (zone) => {
    expect(isListedTimezone(zone)).toBe(true);
  });

  it.each([
    // The runtime accepts each of these, which is why "known" was not enough:
    // an abbreviation, a different case, an offset and an old alias.
    "EST",
    "asia/kuala_lumpur",
    "+08:00",
    "US/Eastern",
    " Asia/Kuala_Lumpur",
    "",
  ])("does not list %j", (zone) => {
    expect(isListedTimezone(zone)).toBe(false);
  });
});
