/**
 * Binding phases refuse drafting from every caller alike (P9-T02,
 * REQUIREMENTS §3.1, METHOD.md §2.3, robustness rule R1).
 *
 * The other half of §3.1, that guided phases never stop anybody, is in
 * `registration-to-dashboard.spec.ts`. This file makes the phases binding
 * and proves the refusal reaches the three ways a person writes an objective:
 * the cycle screen, the REST surface and the `okr` command line. Until P9-T02
 * only the screen refused, because the lock lived behind a flag the screen
 * alone set (completeness review H-09).
 *
 * **A quarter three years out**, so its phases are incomplete and no other
 * spec drafts in it. **The practice is put back** after the last test,
 * whatever happened, because every later spec drafts on the recommended
 * profile.
 */
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

const execFileAsync = promisify(execFile);

async function okr(
  args: readonly string[],
  configFile: string,
): Promise<{ code: number; out: string; err: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings",
        "packages/cli/src/bin/okr.ts",
        ...args,
      ],
      { env: { ...process.env, OPENOKR_CONFIG: configFile } },
    );
    return { code: 0, out: stdout, err: stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: failure.code ?? 1,
      out: failure.stdout ?? "",
      err: failure.stderr ?? "",
    };
  }
}

test.describe.configure({ mode: "serial" });

const ON = `${new Date().getUTCFullYear() + 3}-05-15`;
const REFUSAL = /drafts after the planning phases are complete/;

let context: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";
let base = "";
let cycleId = "";
let memberId = "";

const authed = () => ({ authorization: `Bearer ${token}` });

test.beforeAll(async ({ browser, playwright, baseURL }) => {
  base = baseURL ?? "";
  context = await browser.newContext();
  page = await context.newPage();
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  // Back to the recommended profile's phases, so no later spec meets them.
  if (token) {
    await api.post("/api/v1/practice/update", {
      headers: authed(),
      data: { overrides: { "phases.enforcement": null } },
    });
  }
  await api?.dispose();
  await context?.close();
});

test("an administrator makes the phases binding", async () => {
  await signIn(page);
  await goTo(page, "/account/api-tokens");
  await page.getByLabel("Name").fill("Binding phases e2e");
  await page.getByRole("checkbox", { name: "Write" }).check();
  await page.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("minted-token");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  token = ((await shown.textContent()) ?? "").trim();

  const updated = await api.post("/api/v1/practice/update", {
    headers: authed(),
    data: { overrides: { "phases.enforcement": "binding" } },
  });
  expect(updated.status()).toBe(200);
  expect((await updated.json()).data.practice["phases.enforcement"]).toBe(
    "binding",
  );

  const overview = await api.get("/api/v1/workspace/overview", {
    headers: authed(),
  });
  memberId = (await overview.json()).data.member.id;
  expect(memberId).toBeTruthy();

  // Retry-safe: a cycle can be made once for a period.
  const listed = await api.get("/api/v1/cycles/list", { headers: authed() });
  const existing = (
    (await listed.json()).data as {
      id: string;
      mode: string;
      startsOn: string;
      endsOn: string;
    }[]
  ).find(
    (cycle) =>
      cycle.mode === "quarterly" && cycle.startsOn <= ON && ON <= cycle.endsOn,
  );
  if (existing) {
    cycleId = existing.id;
  } else {
    const created = await api.post("/api/v1/cycles/create", {
      headers: authed(),
      data: { on: ON },
    });
    expect(created.status()).toBe(200);
    cycleId = (await created.json()).data.id;
  }
});

test("the cycle screen gives the add form way to the reasons", async () => {
  await goTo(page, `/cycle?cycle=${cycleId}&phase=4`);
  await expect(page.getByText("This phase is blocked by earlier work")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(REFUSAL)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add objective" })).toHaveCount(
    0,
  );
});

test("the REST surface refuses with the same reason", async () => {
  const response = await api.post("/api/v1/goals/create", {
    headers: authed(),
    data: {
      title: "Make onboarding the reason new customers stay",
      cycleId,
      level: "team",
      ownerKind: "workspace",
      championId: memberId,
      reviewerId: memberId,
    },
  });
  expect(response.status()).toBe(403);
  expect((await response.json()).error.message).toMatch(REFUSAL);
});

test("the command line refuses with the same reason", async () => {
  const configFile = join(mkdtempSync(join(tmpdir(), "okr-e2e-")), "config.json");
  await okr(["login", "--url", base, "--token", token], configFile);
  const refused = await okr(
    [
      "goals",
      "create",
      "--title",
      "Make onboarding the reason new customers stay",
      "--cycle-id",
      cycleId,
      "--level",
      "team",
      "--champion-id",
      memberId,
      "--reviewer-id",
      memberId,
    ],
    configFile,
  );
  // Exit 1 is the instance refusing, as against 2 for a usage error.
  expect(refused.code).toBe(1);
  expect(refused.err).toMatch(REFUSAL);
});
