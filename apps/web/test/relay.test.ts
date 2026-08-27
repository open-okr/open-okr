import { resetEnvCache } from "@openokr/config";
import { afterEach, beforeEach, expect, test } from "vitest";
import { relayEnabled } from "../lib/relay";

/**
 * The relay toggle (P5-T01a).
 *
 * The default matters more than the toggle: a deployment that drains nothing
 * sends no invitation email and publishes no live event, and that was the
 * state of every deployment before this task (PLAN.md §12 R10). So "unset"
 * has to mean "on".
 */

const original = { ...process.env };

beforeEach(() => {
  resetEnvCache();
  process.env.DATABASE_URL = "postgres://openokr:secret@localhost:5432/openokr";
});

afterEach(() => {
  process.env = { ...original };
  resetEnvCache();
});

test("an unconfigured deployment drains", () => {
  process.env.OPENOKR_RELAY = "";
  expect(relayEnabled()).toBe(true);
});

test("off means off, for the operator who wants one dedicated drainer", () => {
  expect(relayEnabled({ OPENOKR_RELAY: "off" })).toBe(false);
});

test("on means on", () => {
  expect(relayEnabled({ OPENOKR_RELAY: "on" })).toBe(true);
});

test("a misspelt value is a boot error, not a silent stop", () => {
  process.env.OPENOKR_RELAY = "fasle";
  expect(() => relayEnabled()).toThrow(/OPENOKR_RELAY/);
});
