import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBrowserFrames } from "../lib/browser-frames.ts";

/**
 * Browser frames resolved through the build's source maps (error-reporting
 * D18, plan 0.7.0 E3).
 *
 * Turbopack names a chunk's map by its own hash and says which in the chunk's
 * last line, so `<chunk>.map` finds nothing. The browser end-to-end check
 * caught it: every frame came back as the chunk it started as.
 */

/** One mapping: generated line 1, column 0 to `src/probe.ts` line 3, column 2. */
const MAP = {
  version: 3,
  sources: ["turbopack:///[project]/apps/web/src/probe.ts"],
  names: [],
  mappings: "AAEE",
};

function staticRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "openokr-frames-"));
  mkdirSync(join(root, "chunks"));
  return root;
}

const frame = (file: string) => ({
  file,
  function: "probe",
  line: 1,
  column: 1,
  inApp: true,
});

describe("a browser frame", () => {
  it("is resolved through the map the chunk names, as Turbopack writes it", async () => {
    const root = staticRoot();
    writeFileSync(
      join(root, "chunks", "02k6zts4zi24x.js"),
      "(()=>{})();\n//# sourceMappingURL=20rgpdkdpmjn7.js.map\n",
    );
    writeFileSync(
      join(root, "chunks", "20rgpdkdpmjn7.js.map"),
      JSON.stringify(MAP),
    );

    const [resolved] = await resolveBrowserFrames(
      [frame("_next/static/chunks/02k6zts4zi24x.js")],
      [root],
    );
    expect(resolved?.file).toContain("probe.ts");
    expect(resolved?.line).toBe(3);
  });

  it("still takes the map beside the chunk when the chunk names none", async () => {
    const root = staticRoot();
    writeFileSync(join(root, "chunks", "a1.js"), "(()=>{})();\n");
    writeFileSync(join(root, "chunks", "a1.js.map"), JSON.stringify(MAP));
    const [resolved] = await resolveBrowserFrames(
      [frame("_next/static/chunks/a1.js")],
      [root],
    );
    expect(resolved?.file).toContain("probe.ts");
  });

  it("refuses a map named as a URL or outside the chunk's directory, and keeps the frame", async () => {
    const root = staticRoot();
    writeFileSync(
      join(root, "chunks", "b2.js"),
      "(()=>{})();\n//# sourceMappingURL=https://evil.example/x.map\n",
    );
    writeFileSync(
      join(root, "chunks", "c3.js"),
      "(()=>{})();\n//# sourceMappingURL=../../secret.map\n",
    );
    const resolved = await resolveBrowserFrames(
      [frame("_next/static/chunks/b2.js"), frame("_next/static/chunks/c3.js")],
      [root],
    );
    expect(resolved.map((one) => one.file)).toEqual([
      "_next/static/chunks/b2.js",
      "_next/static/chunks/c3.js",
    ]);
  });
});
