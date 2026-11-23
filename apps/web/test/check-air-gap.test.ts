import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { checkFontAssets } from "../../../scripts/check-air-gap.ts";

const fontDir = "apps/web/public/fonts";
let root: string;

async function writeFixture(path: string, content: string) {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

function stage(...paths: string[]) {
  execFileSync("git", ["add", "--", ...paths], { cwd: root, stdio: "pipe" });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openokr-font-check-"));
  execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "pipe" });
  await writeFixture(`${fontDir}/pdf/NotoSansSC-Regular.otf`, "OTF");
  await writeFixture(`${fontDir}/pdf/NotoSansArabic-Regular.ttf`, "TTF");
  stage(`${fontDir}/pdf`);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("vendored font assets (languages AC-30)", () => {
  test("accepts a tracked file named by a relative @font-face URL", async () => {
    await writeFixture(
      `${fontDir}/fonts.css`,
      "@font-face { font-family: Test; src: url('./test.woff2') format('woff2'); }",
    );
    await writeFixture(`${fontDir}/test.woff2`, "WOFF2");
    stage(`${fontDir}/test.woff2`);
    expect(await checkFontAssets(root)).toEqual([]);
  });

  test("reports remote, missing and untracked font files", async () => {
    await writeFixture(
      `${fontDir}/fonts.css`,
      `@font-face {
        font-family: Test;
        src: url("https://assets.example/font.woff2"), url(./missing.woff2), url(./untracked.woff2);
      }`,
    );
    await writeFixture(`${fontDir}/untracked.woff2`, "WOFF2");
    const failures = await checkFontAssets(root);
    expect(failures).toHaveLength(3);
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("https://assets.example/font.woff2"),
        expect.stringContaining("./missing.woff2"),
        expect.stringContaining("./untracked.woff2"),
      ]),
    );
  });

  test("requires both minutes PDF font paths", async () => {
    await rm(join(root, fontDir, "pdf/NotoSansSC-Regular.otf"));
    expect(await checkFontAssets(root)).toEqual([
      expect.stringContaining("pdf/NotoSansSC-Regular.otf"),
    ]);
  });
});
