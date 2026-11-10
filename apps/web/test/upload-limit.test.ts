import { readFileSync } from "node:fs";
import { MAX_BLOB_BYTES } from "@openokr/core";
import { describe, expect, test } from "vitest";
import { UPLOAD_LIMIT_BYTES } from "../lib/upload-limit";

// Plan 0.8.0 H13: the server-action body limit was 8 MB and the blob limit
// 25 MiB, so a file between the two was cut off with a generic failure before
// core could say the real limit.

const config = readFileSync(
  new URL("../next.config.ts", import.meta.url),
  "utf8",
);

describe("the upload limit", () => {
  test("the browser's number is core's number", () => {
    expect(UPLOAD_LIMIT_BYTES).toBe(MAX_BLOB_BYTES);
  });

  test("a server action takes the largest file, with room for the form", () => {
    const match = /bodySizeLimit:\s*"(\d+)mb"/.exec(config);
    expect(match).not.toBeNull();
    const bodyBytes = Number(match?.[1]) * 1024 * 1024;
    expect(bodyBytes).toBeGreaterThanOrEqual(MAX_BLOB_BYTES + 1024 * 1024);
  });
});
