import { resetEnvCache } from "@openokr/config";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { outboxDrained, relayMode } from "../lib/background-work";
import { relayEnabled, startRelay } from "../lib/relay";

// What a process with the relay `elsewhere` registers, without a database.
const gauges = new Map<string, () => unknown>();
vi.mock("../lib/telemetry", () => ({
  getTelemetry: () => ({
    gauge: (name: string, read: () => unknown) => gauges.set(name, read),
  }),
}));
// A pool nothing connects to: the gauges are read at scrape time, not here.
vi.mock("../lib/pool", () => ({ getPool: () => ({}) }));

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

// docs/design/worker-deployment.md D2 and §1.3, plan 0.8.0 H10d.
test("elsewhere is not here, but the queue is still drained", () => {
  expect(relayEnabled({ OPENOKR_RELAY: "elsewhere" })).toBe(false);
  expect(relayMode({ OPENOKR_RELAY: "elsewhere" })).toBe("elsewhere");
  expect(outboxDrained({ OPENOKR_RELAY: "elsewhere" })).toBe(true);
  expect(outboxDrained({ OPENOKR_RELAY: "on" })).toBe(true);
  expect(outboxDrained({ OPENOKR_RELAY: "off" })).toBe(false);
});

test("a misspelt value is a boot error for the mode too", () => {
  process.env.OPENOKR_RELAY = "sometimes";
  expect(() => relayMode()).toThrow(/OPENOKR_RELAY/);
});

test("with the relay elsewhere, boot starts none, says so, and serves the queue's gauges", () => {
  process.env.OPENOKR_RELAY = "elsewhere";
  gauges.clear();
  const written: string[] = [];
  const write = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
  try {
    expect(startRelay()).toBeNull();
  } finally {
    write.mockRestore();
  }
  expect(written).toContain(
    "relay: runs elsewhere (OPENOKR_RELAY=elsewhere)\n",
  );
  expect([...gauges.keys()]).toEqual(
    expect.arrayContaining([
      "openokr_outbox_pending",
      "openokr_outbox_oldest_pending_seconds",
    ]),
  );
});

test("with the relay off, boot registers no gauges, as before", () => {
  process.env.OPENOKR_RELAY = "off";
  gauges.clear();
  const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  try {
    expect(startRelay()).toBeNull();
  } finally {
    write.mockRestore();
  }
  expect(gauges.size).toBe(0);
});
