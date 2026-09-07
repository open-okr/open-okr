/**
 * The device login (TECHNICAL-PLAN §14, P5-T07c-b).
 *
 * Acceptance criterion:
 *   Given a signed-out terminal, when a person runs the device login and
 *   completes it in the browser, then the profile holds a scoped token and the
 *   next command runs as them.
 *
 * This is the one flow in the product where two clients have to meet, so it is
 * the one only an end-to-end test can settle. The terminal is a real process
 * with its own configuration file and no session at all; the browser is a real
 * browser with one. Neither can see the other except through the instance.
 *
 * **The login is spawned rather than exec'd**, because a person reads the link
 * while the process is still waiting. `execFile` buffers until exit, which would
 * mean either a test-only hook in the product to write the link somewhere or a
 * deadlock. Reading the stream is what a terminal does anyway.
 *
 * Everything a device request *is* (hashed codes, expiry, granting once, the
 * scopes it asked for and no more) is proved against a real database in
 * `packages/core/test/device-login.test.ts`.
 */
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { goTo, signIn } from "./instance-account.ts";

const execFileAsync = promisify(execFile);

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let base = "";
let configFile = "";

const BIN = ["--experimental-strip-types", "--no-warnings", "packages/cli/src/bin/okr.ts"];

/** A command that finishes on its own. */
function okr(
  args: readonly string[],
): Promise<{ code: number; out: string; err: string }> {
  return execFileAsync(process.execPath, [...BIN, ...args], {
    env: { ...process.env, OPENOKR_CONFIG: configFile },
  })
    .then(({ stdout, stderr }) => ({ code: 0, out: stdout, err: stderr }))
    .catch((error) => {
      const failure = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      return {
        code: failure.code ?? 1,
        out: failure.stdout ?? "",
        err: failure.stderr ?? "",
      };
    });
}

interface RunningLogin {
  /** Resolves with the link the terminal printed. */
  readonly link: Promise<string>;
  /** Resolves when the process exits. */
  readonly finished: Promise<{ code: number; err: string }>;
}

/**
 * Starts a login and hands back the link it prints.
 *
 * The link is taken from the terminal's own output, not built here: a test that
 * constructed the URL itself would pass even if the tool printed the wrong one.
 */
function startLogin(args: readonly string[]): RunningLogin {
  const child = spawn(process.execPath, [...BIN, "login", ...args], {
    env: { ...process.env, OPENOKR_CONFIG: configFile },
  });

  let err = "";
  let settleLink: (value: string) => void = () => {};
  let failLink: (reason: Error) => void = () => {};
  const link = new Promise<string>((resolve, reject) => {
    settleLink = resolve;
    failLink = reject;
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    err += chunk;
    const match = /(https?:\/\/\S*\/account\/device\?code=\S+)/.exec(err);
    if (match?.[1]) {
      settleLink(match[1]);
    }
  });

  const finished = new Promise<{ code: number; err: string }>((resolve) => {
    child.on("close", (code) => {
      failLink(new Error(`The login exited before printing a link.\n${err}`));
      resolve({ code: code ?? 1, err });
    });
  });

  return { link, finished };
}

const storedProfiles = (): Record<
  string,
  { url: string; token: string } | undefined
> => {
  try {
    return (
      JSON.parse(readFileSync(configFile, "utf8")) as {
        profiles: Record<string, { url: string; token: string }>;
      }
    ).profiles;
  } catch {
    return {};
  }
};

test.beforeAll(async ({ browser, baseURL }) => {
  base = baseURL ?? "";
  context = await browser.newContext();
  page = await context.newPage();
  configFile = join(mkdtempSync(join(tmpdir(), "okr-device-")), "config.json");
});

test.afterAll(async () => {
  await context?.close();
});

test("sign in, so the browser has the session the terminal does not", async () => {
  await signIn(page);
});

test("a code nobody issued has nothing to approve", async () => {
  await goTo(page, "/account/device?code=ZZZZ-ZZZZ");
  await expect(
    page.getByRole("heading", { level: 1, name: "Authorise a terminal" }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("There is nothing to authorise")).toBeVisible();
});

test("acceptance: a signed-out terminal ends up holding a scoped token", async () => {
  // The terminal starts with nothing: no session, no token, and a configuration
  // file that does not exist yet. It never sees a password.
  expect(storedProfiles().default).toBeUndefined();

  const login = startLogin([
    "--url",
    base,
    "--scopes",
    "read",
    // Nothing opens. A test run must not put a tab in the browser of whoever
    // is watching it.
    "--no-browser",
  ]);
  const printed = await login.link;

  await goTo(page, printed.slice(printed.indexOf("/account/device")));
  await expect(page.getByTestId("device-client")).toContainText("okr on ", {
    timeout: 10_000,
  });
  // The scopes it asked for, shown as they are, and no control for widening
  // them: read only, because read only is what the terminal asked for.
  await expect(page.getByText("read", { exact: true })).toBeVisible();
  await expect(page.getByText("write", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Authorise this terminal" }).click();
  await expect(page.getByRole("status")).toContainText("can now act as you", {
    timeout: 15_000,
  });

  const result = await login.finished;
  expect(result.code).toBe(0);

  const token = storedProfiles().default?.token ?? "";
  expect(token).toMatch(/^okr_rest_/);
  // Printed nowhere, including by the command that just received it.
  expect(result.err).not.toContain(token);

  // **And the next command runs as them.** No token on the command line: it
  // comes from the profile the login just wrote.
  const listed = await okr(["goals", "list"]);
  expect(listed.code).toBe(0);
  expect(JSON.parse(listed.out)).toHaveProperty("goals");
});

test("the granted token carries read only, so a write is refused for scope", async () => {
  const refused = await okr([
    "people",
    "updateOwnProfile",
    "--timezone",
    "Asia/Jakarta",
  ]);
  expect(refused.code).toBe(1);
  // Asked for read, granted read. Nothing in the browser could have added more.
  expect(refused.err).toContain("write scope");
});

test("the token appears in the account list, named after the terminal", async () => {
  await goTo(page, "/account/api-tokens");
  await expect(
    page.getByTestId("token-row").filter({ hasText: "Terminal:" }).first(),
  ).toContainText("read", { timeout: 10_000 });
});

test("refusing one in the browser ends the terminal's login", async () => {
  const login = startLogin([
    "--url",
    base,
    "--profile",
    "refused",
    "--no-browser",
  ]);
  const printed = await login.link;

  await goTo(page, printed.slice(printed.indexOf("/account/device")));
  await page.getByRole("button", { name: "Refuse" }).click();
  await expect(page.getByRole("status")).toContainText("was refused", {
    timeout: 15_000,
  });

  const result = await login.finished;
  expect(result.code).toBe(1);
  expect(result.err).toContain("refused");
  expect(storedProfiles().refused).toBeUndefined();
});
