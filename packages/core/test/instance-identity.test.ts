import { workerDb } from "@openokr/test-support/db";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  resolveLegalLinks,
  resolveSourceUrl,
  resolveSupportEmail,
} from "../src/secrets/instance-identity.ts";
import { DEFAULT_SOURCE_URL } from "../src/secrets/instance-registry.ts";

/**
 * A provider's own source link, legal pages and contact (PLAN.md §4 and §5.2).
 *
 * AGPL-3.0 §13 is why the source link cannot be a literal: a provider who changed
 * the code has to offer their own. Everything here ends up in an `href`.
 */

const setStored = async (key: string, value: string) => {
  const wb = await workerDb();
  await wb.admin.query(
    "insert into system_settings (key, value) values ($1, $2::jsonb)",
    [key, JSON.stringify(value)],
  );
};

beforeEach(async () => {
  const wb = await workerDb();
  await wb.admin.query("delete from system_settings");
});

afterAll(async () => {
  const wb = await workerDb();
  await wb.close();
});

describe("the source link", () => {
  it("points upstream until somebody says otherwise", async () => {
    const wb = await workerDb();
    await expect(resolveSourceUrl(wb.appPool, {})).resolves.toBe(
      DEFAULT_SOURCE_URL,
    );
  });

  it("takes the provider's own, from the environment", async () => {
    const wb = await workerDb();
    await expect(
      resolveSourceUrl(wb.appPool, {
        OPENOKR_SOURCE_URL: "https://git.example.com/our-fork",
      }),
    ).resolves.toBe("https://git.example.com/our-fork");
  });

  it("prefers a stored value over the environment", async () => {
    const wb = await workerDb();
    await setStored("instance.sourceUrl", "https://stored.example.com/fork");
    await expect(
      resolveSourceUrl(wb.appPool, {
        OPENOKR_SOURCE_URL: "https://env.example.com/fork",
      }),
    ).resolves.toBe("https://stored.example.com/fork");
  });

  it("refuses anything that is not a web address", async () => {
    const wb = await workerDb();
    await expect(
      resolveSourceUrl(wb.appPool, {
        OPENOKR_SOURCE_URL: "javascript:alert(1)",
      }),
    ).resolves.toBe(DEFAULT_SOURCE_URL);
  });
});

describe("the legal pages", () => {
  it("are absent by default, so a self-hosted sign-up shows nothing", async () => {
    const wb = await workerDb();
    await expect(resolveLegalLinks(wb.appPool, {})).resolves.toEqual({
      termsUrl: null,
      privacyUrl: null,
    });
  });

  it("are read one at a time, and a bad address reads as absent", async () => {
    const wb = await workerDb();
    await expect(
      resolveLegalLinks(wb.appPool, {
        OPENOKR_TERMS_URL: "https://example.com/terms",
        OPENOKR_PRIVACY_URL: "not an address",
      }),
    ).resolves.toEqual({
      termsUrl: "https://example.com/terms",
      privacyUrl: null,
    });
  });
});

describe("the support address", () => {
  it("is absent by default, and only ever an address", async () => {
    const wb = await workerDb();
    await expect(resolveSupportEmail(wb.appPool, {})).resolves.toBeNull();
    await expect(
      resolveSupportEmail(wb.appPool, { OPENOKR_SUPPORT_EMAIL: "nope" }),
    ).resolves.toBeNull();
    await expect(
      resolveSupportEmail(wb.appPool, {
        OPENOKR_SUPPORT_EMAIL: "help@example.com",
      }),
    ).resolves.toBe("help@example.com");
  });
});

describe("a database that does not answer", () => {
  it("still gives the sign-up page and the shell something to draw", async () => {
    const broken = {
      connect: () => Promise.reject(new Error("the database is down")),
      query: () => Promise.reject(new Error("the database is down")),
    } as unknown as Pool;
    await expect(resolveSourceUrl(broken, {})).resolves.toBe(
      DEFAULT_SOURCE_URL,
    );
    await expect(resolveLegalLinks(broken, {})).resolves.toEqual({
      termsUrl: null,
      privacyUrl: null,
    });
  });
});
