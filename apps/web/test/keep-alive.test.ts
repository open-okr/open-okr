import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { HEARTBEAT_MS, keepAlive } from "../lib/keep-alive";

// Plan 0.8.0 H11: a live stream sent one heartbeat when it opened and nothing
// after, so a load balancer's idle timeout (60 s on AWS) or a CDN's (about
// 100 s on Cloudflare) cut it and every tab reconnected once a minute.

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("keepAlive", () => {
  test("speaks every 25 seconds, under every proxy's idle timeout", () => {
    expect(HEARTBEAT_MS).toBeLessThan(60_000);
    const send = vi.fn();
    const request = new AbortController();
    keepAlive(send, request.signal);
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    expect(send).toHaveBeenCalledTimes(3);
  });

  test("stops when the request ends", () => {
    const send = vi.fn();
    const request = new AbortController();
    keepAlive(send, request.signal);
    vi.advanceTimersByTime(HEARTBEAT_MS);
    request.abort();
    vi.advanceTimersByTime(HEARTBEAT_MS * 4);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("stops when the stream is already closed and a write throws", () => {
    const send = vi.fn(() => {
      throw new TypeError("Invalid state: Controller is already closed");
    });
    keepAlive(send, new AbortController().signal);
    vi.advanceTimersByTime(HEARTBEAT_MS * 4);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("every live route", () => {
  const api = fileURLToPath(new URL("../app/api", import.meta.url));
  const live = readdirSync(api).filter((name) => {
    try {
      readFileSync(join(api, name, "live", "route.ts"));
      return true;
    } catch {
      return false;
    }
  });

  test("keeps its stream alive", () => {
    expect(live.length).toBeGreaterThanOrEqual(5);
    for (const name of live) {
      const route = readFileSync(join(api, name, "live", "route.ts"), "utf8");
      expect(route, name).toContain("keepAlive(");
    }
  });
});
