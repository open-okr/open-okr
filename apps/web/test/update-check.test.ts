import { describe, expect, it, vi } from "vitest";
import {
  createUpdateChecker,
  isBehind,
  parseRelease,
} from "../lib/update-check.ts";

/** The update check (docs/design/version-footer.md §2). */

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const release = (tag: string) => ({
  ok: true as const,
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({
    tag_name: tag,
    html_url: `https://github.com/open-okr/open-okr/releases/tag/${tag}`,
  }),
});

const refused = {
  ok: false as const,
  refusal: "unreachable" as const,
  detail: "no route",
};

describe("comparing versions", () => {
  it("is behind only when the release is strictly newer", () => {
    expect(isBehind("0.4.0", "0.5.0")).toBe(true);
    expect(isBehind("0.4.0", "0.4.1")).toBe(true);
    expect(isBehind("0.4.0", "1.0.0")).toBe(true);
    expect(isBehind("0.4.0", "0.4.0")).toBe(false);
    expect(isBehind("0.10.0", "0.9.0")).toBe(false);
  });

  it("reads a running pre-release as its base number", () => {
    expect(isBehind("0.5.0-rc.1", "0.4.0")).toBe(false);
    expect(isBehind("0.5.0-rc.1", "0.5.0")).toBe(false);
  });

  it("is never behind a number it cannot read", () => {
    expect(isBehind("0.4.0", "latest")).toBe(false);
    expect(isBehind("dev", "0.5.0")).toBe(false);
  });
});

describe("reading GitHub's answer", () => {
  it("takes the tag without its v, and the release page", () => {
    expect(parseRelease(release("v0.5.0").body)).toEqual({
      version: "0.5.0",
      url: "https://github.com/open-okr/open-okr/releases/tag/v0.5.0",
    });
  });

  it("refuses anything else", () => {
    expect(parseRelease("not json")).toBeNull();
    expect(parseRelease(JSON.stringify({ tag_name: "v1.0.0" }))).toBeNull();
    expect(
      parseRelease(
        JSON.stringify({ tag_name: "v1.0.0", html_url: "javascript:alert(1)" }),
      ),
    ).toBeNull();
  });
});

describe("the checker", () => {
  const setup = () => {
    let now = 0;
    const fetch = vi.fn();
    const checker = createUpdateChecker({ fetch, now: () => now });
    return {
      fetch,
      checker,
      advance: (ms: number) => {
        now += ms;
      },
    };
  };

  it("never waits: the first read is empty and starts one request", async () => {
    const { fetch, checker } = setup();
    fetch.mockResolvedValue(release("v0.5.0"));
    expect(checker.latest()).toBeNull();
    expect(checker.latest()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    await checker.settled();
    expect(checker.latest()?.version).toBe("0.5.0");
  });

  it("asks again after a day, not before", async () => {
    const { fetch, checker, advance } = setup();
    fetch.mockResolvedValue(release("v0.5.0"));
    checker.latest();
    await checker.settled();
    advance(DAY - 1);
    checker.latest();
    expect(fetch).toHaveBeenCalledTimes(1);
    advance(2);
    fetch.mockResolvedValue(release("v0.6.0"));
    expect(checker.latest()?.version).toBe("0.5.0");
    await checker.settled();
    expect(checker.latest()?.version).toBe("0.6.0");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("waits an hour after a failure", async () => {
    const { fetch, checker, advance } = setup();
    fetch.mockResolvedValue(refused);
    checker.latest();
    await checker.settled();
    advance(HOUR - 1);
    checker.latest();
    expect(fetch).toHaveBeenCalledTimes(1);
    advance(2);
    checker.latest();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("survives a fetch that throws", async () => {
    const { fetch, checker } = setup();
    fetch.mockRejectedValue(new Error("boom"));
    expect(checker.latest()).toBeNull();
    await checker.settled();
    expect(checker.latest()).toBeNull();
  });

  it("sends nothing about the instance", async () => {
    const { fetch, checker } = setup();
    fetch.mockResolvedValue(release("v0.5.0"));
    checker.latest();
    await checker.settled();
    const [url, options] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://api.github.com/repos/open-okr/open-okr/releases/latest",
    );
    expect(options.headers["user-agent"]).toBe("OpenOKR-update-check");
    expect(JSON.stringify(options)).not.toMatch(/\d+\.\d+\.\d+/);
  });
});
