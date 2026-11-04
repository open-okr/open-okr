import {
  ACTION_HEADER,
  NEXT_ROUTER_PREFETCH_HEADER,
  NEXT_ROUTER_SEGMENT_PREFETCH_HEADER,
  RSC_HEADER,
} from "next/dist/client/components/app-router-headers.js";
import { describe, expect, test } from "vitest";
import {
  createRequestActivity,
  isAppRequest,
} from "../lib/request-activity.ts";

/**
 * The shell's answer to "did my click land?" for everything that is not a
 * link: a save, a create, an edit, a refresh after a write. Every one of them
 * reaches the server through `fetch` with a header Next sets, so counting
 * those requests is the one place that sees them all, the way `ajaxStart`
 * did for jQuery.
 */

describe("which requests count", () => {
  test("a server action counts", () => {
    expect(
      isAppRequest("/spaces/1", { headers: { "Next-Action": "a1" } }),
    ).toBe(true);
  });

  test("a refresh or navigation for server components counts", () => {
    expect(isAppRequest("/goals", { headers: new Headers({ RSC: "1" }) })).toBe(
      true,
    );
    expect(isAppRequest("/goals", { headers: [["rsc", "1"]] })).toBe(true);
  });

  test("a Request object carries its own headers", () => {
    const request = new Request("http://localhost/x", {
      headers: { "next-action": "a1" },
    });
    expect(isAppRequest(request, undefined)).toBe(true);
  });

  test("a prefetch does not count: nobody clicked anything", () => {
    expect(
      isAppRequest("/goals", {
        headers: { rsc: "1", "next-router-prefetch": "1" },
      }),
    ).toBe(false);
    expect(
      isAppRequest("/goals", {
        headers: { rsc: "1", "next-router-segment-prefetch": "/_tree" },
      }),
    ).toBe(false);
  });

  test("the live feed, the badges and every plain fetch do not count", () => {
    expect(isAppRequest("/api/feed/live?scope=workspace", undefined)).toBe(
      false,
    );
    expect(isAppRequest("/api/review/badge", { method: "GET" })).toBe(false);
  });

  // The headers are Next's, not a public API. If an upgrade renames one, this
  // fails here instead of the indicator going quiet in production.
  test("the header names are the ones this version of Next sends", () => {
    expect(ACTION_HEADER.toLowerCase()).toBe("next-action");
    expect(RSC_HEADER.toLowerCase()).toBe("rsc");
    expect(NEXT_ROUTER_PREFETCH_HEADER.toLowerCase()).toBe(
      "next-router-prefetch",
    );
    expect(NEXT_ROUTER_SEGMENT_PREFETCH_HEADER.toLowerCase()).toBe(
      "next-router-segment-prefetch",
    );
  });
});

describe("the count", () => {
  test("rises while a request is in flight and falls when it settles", async () => {
    let finish: (value: Response) => void = () => {};
    const base = () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      });
    const activity = createRequestActivity();
    const tracked = activity.wrap(base as typeof fetch);
    const seen: number[] = [];
    activity.subscribe(() => seen.push(activity.count()));

    const pending = tracked("/x", { headers: { "next-action": "a" } });
    expect(activity.count()).toBe(1);
    finish(new Response("ok"));
    await pending;
    expect(activity.count()).toBe(0);
    expect(seen).toEqual([1, 0]);
  });

  test("a failed request still lets the count fall", async () => {
    const activity = createRequestActivity();
    const tracked = activity.wrap((() =>
      Promise.reject(new TypeError("offline"))) as typeof fetch);
    await expect(
      tracked("/x", { headers: { "next-action": "a" } }),
    ).rejects.toThrow("offline");
    expect(activity.count()).toBe(0);
  });

  test("a request that does not count leaves it alone", async () => {
    const activity = createRequestActivity();
    const tracked = activity.wrap((() =>
      Promise.resolve(new Response("ok"))) as typeof fetch);
    const pending = tracked("/api/feed/live", undefined);
    expect(activity.count()).toBe(0);
    await pending;
    expect(activity.count()).toBe(0);
  });
});
