import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  BROWSER_TIMEZONE_COOKIE,
  DEVICE_CODE_ALPHABET,
  DEVICE_USER_CODE_GROUPS,
  DOMAIN_PATTERN,
  EMAIL_PATTERN,
  formatDeviceUserCode,
  HEX_COLOUR_HTML_PATTERN,
  HEX_COLOUR_PATTERN,
  hostOf,
  isDomain,
  isEmailAddress,
  isHexColour,
  isHostName,
  isKnownTimezone,
  isListedTimezone,
  isLocalDate,
  isOneWord,
  isSlug,
  isWebUrl,
  LOCAL_DATE_PATTERN,
  listTimezones,
  localDateTimeInstant,
  localDayBounds,
  matchListedTimezone,
  normaliseWallClock,
  parseWallClock,
  zonedInstant,
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

describe("a wall-clock time", () => {
  it("takes an hour of one digit or two, and stores two", () => {
    expect(normaliseWallClock("9:30")).toBe("09:30");
    expect(normaliseWallClock("09:30")).toBe("09:30");
    expect(normaliseWallClock(" 23:59 ")).toBe("23:59");
    expect(normaliseWallClock("0:00")).toBe("00:00");
  });

  it("refuses a time no clock shows", () => {
    for (const text of ["99:99", "24:00", "12:60", "9:5", "930", "", "noon"]) {
      expect(parseWallClock(text)).toBeNull();
    }
  });

  it("reads the hour and the minute", () => {
    expect(parseWallClock("7:05")).toEqual({ hour: 7, minute: 5 });
  });
});

describe("a local day in a zone", () => {
  it("starts at the zone's midnight and ends just before the next", () => {
    const day = localDayBounds("2026-10-31", "Asia/Jakarta");
    expect(day.start.toISOString()).toBe("2026-10-30T17:00:00.000Z");
    expect(day.end.toISOString()).toBe("2026-10-31T16:59:59.999Z");
  });

  it("reads the offset from the date, so a day a clock changes on is right", () => {
    // London moves back an hour on 25 October 2026, so the day is 25 hours.
    const day = localDayBounds("2026-10-25", "Europe/London");
    expect(day.start.toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(day.end.toISOString()).toBe("2026-10-25T23:59:59.999Z");
  });

  it("reads what a date and time control posts on the clock of the zone given", () => {
    // guided-inputs §7: an operator in Kuala Lumpur, a server in UTC.
    expect(
      localDateTimeInstant(
        "2026-10-12T09:00",
        "Asia/Kuala_Lumpur",
      )?.toISOString(),
    ).toBe("2026-10-12T01:00:00.000Z");
    expect(localDateTimeInstant("2026-10-12T09:00:00+08:00", "UTC")).toBeNull();
    expect(localDateTimeInstant("next Monday", "UTC")).toBeNull();
  });

  it("names the same wall-clock time as a different instant in each zone", () => {
    expect(zonedInstant("2026-10-12", "UTC", 9, 30).toISOString()).toBe(
      "2026-10-12T09:30:00.000Z",
    );
    expect(
      zonedInstant("2026-10-12", "America/New_York", 9, 30).toISOString(),
    ).toBe("2026-10-12T13:30:00.000Z");
  });
});

describe("a host an AI call may reach", () => {
  it("is a name or an address, never a URL", () => {
    for (const host of ["api.openai.com", "localhost", "10.0.0.7", "::1"]) {
      expect(isHostName(host)).toBe(true);
    }
    for (const host of [
      "https://api.openai.com",
      "api.openai.com/v1",
      "-bad.example",
      "",
    ]) {
      expect(isHostName(host)).toBe(false);
    }
  });

  it("is what a pasted address leaves once its host is taken", () => {
    expect(hostOf("https://openrouter.ai/api/v1")).toBe("openrouter.ai");
    expect(hostOf(" API.Anthropic.com ")).toBe("api.anthropic.com");
    expect(hostOf("not_a_host!")).toBe("not_a_host!");
  });
});

describe("web addresses and identifiers (guided-inputs §4.11)", () => {
  it("takes a whole http or https address, and only https when asked", () => {
    for (const url of [
      "https://idp.example/.well-known/openid-configuration",
      "http://localhost:11434/v1",
      "http://127.0.0.1:8080",
    ]) {
      expect(isWebUrl(url)).toBe(true);
    }
    for (const url of [
      "",
      "idp.example/token",
      "localhost:11434",
      "ftp://idp.example/file",
      "javascript:alert(1)",
      "https://",
      "mailto:priya@northwind.example",
    ]) {
      expect(isWebUrl(url)).toBe(false);
    }
    expect(isWebUrl("https://idp.example/token", { secure: true })).toBe(true);
    expect(isWebUrl("http://idp.example/token", { secure: true })).toBe(false);
    // Plain http that never leaves this machine is still taken.
    for (const url of [
      "http://localhost:8080/realms/acme",
      "http://127.0.0.1:9000/token",
      "http://[::1]:9000/token",
    ]) {
      expect(isWebUrl(url, { secure: true })).toBe(true);
    }
    expect(isWebUrl("http://localhost.example/token", { secure: true })).toBe(
      false,
    );
  });

  it("tells one word from a phrase, and a slug from anything else", () => {
    expect(isOneWord("C0123ABCD")).toBe(true);
    expect(isOneWord("19:abc@thread.tacv2")).toBe(true);
    expect(isOneWord("team updates")).toBe(false);
    expect(isOneWord("")).toBe(false);
    expect(isSlug("acme-idp-2")).toBe(true);
    for (const id of ["Acme", "acme_idp", "acme idp", ""]) {
      expect(isSlug(id)).toBe(false);
    }
  });
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

/**
 * A zone a browser reports, matched to the server's list (docs/design/
 * browser-timezone.md). The browser and the server ask the same function, so
 * the picker's "use this device's zone" and the default a workspace is born
 * with cannot disagree.
 */
describe("a browser's zone, matched to the list", () => {
  it("takes a listed name as it is", () => {
    expect(matchListedTimezone("Asia/Kuala_Lumpur")).toBe("Asia/Kuala_Lumpur");
    expect(matchListedTimezone("UTC")).toBe("UTC");
  });

  it("finds the listed spelling of a zone the browser names differently", () => {
    // One zone with two names. Whichever this runtime lists, the other one
    // resolves to it, and what comes back is always a name on the list.
    const matched = matchListedTimezone("Asia/Calcutta");
    expect(matched === null || isListedTimezone(matched)).toBe(true);
    expect(matched).toBe(matchListedTimezone("Asia/Kolkata"));
  });

  it("matches against a list it is given", () => {
    expect(matchListedTimezone("Asia/Kuala_Lumpur", ["UTC"])).toBeNull();
  });

  // `+08:00` is a zone the runtime accepts and no listed name resolves to, so
  // it is refused here as the settings card refuses it.
  it.each(["Mars/Olympus_Mons", "", "not a zone", "+08:00"])(
    "offers nothing for %j",
    (zone) => {
      expect(matchListedTimezone(zone)).toBeNull();
    },
  );

  it("names the cookie once, for the browser that writes it and the server that reads it", () => {
    expect(BROWSER_TIMEZONE_COOKIE).toBe("openokr_tz");
  });
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
