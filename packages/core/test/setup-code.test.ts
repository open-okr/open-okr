import { describe, expect, it } from "vitest";
import {
  checkSetupCode,
  formatSetupCode,
  generateSetupCode,
  hashSetupCode,
  normaliseSetupCode,
  SETUP_CODE_ALPHABET,
  setupCodeMatches,
  setupCodePath,
} from "../src/setup/setup-code.ts";

/**
 * The pure half of the setup code (docs/design/setup-code.md D5, D6): the
 * alphabet, the grouping, the normalising and the keyed compare. What touches
 * the database or the disk is in `registration-policy.test.ts`.
 */

const SECRET = "a-test-secret-of-sufficient-length-for-signing";
const OTHER_SECRET = "another-test-secret-of-sufficient-length-here";

describe("a generated code", () => {
  it("is twelve characters in three groups of four", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateSetupCode()).toMatch(
        /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/,
      );
    }
  });

  it("uses only the 31-character alphabet, with no 0, O, 1, I or L", () => {
    expect(SETUP_CODE_ALPHABET).toHaveLength(31);
    for (const confusing of ["0", "O", "1", "I", "L"]) {
      expect(SETUP_CODE_ALPHABET).not.toContain(confusing);
    }
    for (let i = 0; i < 200; i += 1) {
      for (const character of generateSetupCode().replaceAll("-", "")) {
        expect(SETUP_CODE_ALPHABET).toContain(character);
      }
    }
  });

  it("is not the same twice", () => {
    const codes = new Set(
      Array.from({ length: 100 }, () => generateSetupCode()),
    );
    expect(codes.size).toBe(100);
  });
});

describe("normalising", () => {
  it("upper-cases and drops spaces and dashes, so typed and printed forms agree", () => {
    expect(normaliseSetupCode("abcd efgh jkmn")).toBe("ABCDEFGHJKMN");
    expect(normaliseSetupCode("ABCD-EFGH-JKMN")).toBe("ABCDEFGHJKMN");
    expect(normaliseSetupCode("  abcd-efgh jkmn \n")).toBe("ABCDEFGHJKMN");
  });

  it("formats a normalised code in groups of four", () => {
    expect(formatSetupCode("ABCDEFGHJKMN")).toBe("ABCD-EFGH-JKMN");
  });
});

describe("the keyed compare", () => {
  const hash = hashSetupCode(SECRET, "ABCD-EFGH-JKMN");

  it("is a hex HMAC-SHA256, 64 characters", () => {
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes every spelling of one code to one value", () => {
    expect(hashSetupCode(SECRET, "abcd efgh jkmn")).toBe(hash);
    expect(hashSetupCode(SECRET, "ABCDEFGHJKMN")).toBe(hash);
  });

  it("depends on the secret, so a copy of the database alone cannot test guesses", () => {
    expect(hashSetupCode(OTHER_SECRET, "ABCD-EFGH-JKMN")).not.toBe(hash);
    expect(setupCodeMatches(OTHER_SECRET, "ABCD-EFGH-JKMN", hash)).toBe(false);
  });

  it("accepts the right code in any case and refuses another", () => {
    expect(setupCodeMatches(SECRET, "abcd-efgh-jkmn", hash)).toBe(true);
    expect(setupCodeMatches(SECRET, "ABCD-EFGH-JKMP", hash)).toBe(false);
  });

  it("refuses a stored value of the wrong length rather than throwing", () => {
    expect(setupCodeMatches(SECRET, "ABCD-EFGH-JKMN", "abcd")).toBe(false);
    expect(setupCodeMatches(SECRET, "ABCD-EFGH-JKMN", "")).toBe(false);
  });
});

describe("judging a request against the deployment's code", () => {
  // The environment source never reads the database, so no pool is needed.
  const noPool = undefined as never;

  it("is required when the request carries nothing", async () => {
    for (const presented of [undefined, null, "", "  -  "]) {
      expect(
        await checkSetupCode(noPool, SECRET, presented, "ABCD-EFGH-JKMN"),
      ).toBe("required");
    }
  });

  it("is wrong when the code differs", async () => {
    expect(
      await checkSetupCode(noPool, SECRET, "ZZZZ-ZZZZ-ZZZZ", "ABCD-EFGH-JKMN"),
    ).toBe("wrong");
  });

  it("is ok for the code in any case, with or without dashes", async () => {
    for (const presented of [
      "ABCD-EFGH-JKMN",
      "abcd efgh jkmn",
      "abcdefghjkmn",
    ]) {
      expect(
        await checkSetupCode(noPool, SECRET, presented, "ABCD-EFGH-JKMN"),
      ).toBe("ok");
    }
  });
});

describe("where the generated code is kept", () => {
  it("is a file named setup-code under the given storage root, as an absolute path", () => {
    expect(setupCodePath("/srv/storage")).toBe("/srv/storage/setup-code");
  });
});
