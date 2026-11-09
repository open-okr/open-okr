/**
 * Error reporting, end to end (docs/design/error-reporting.md §5 E2 and E3,
 * §6, plan 0.7.0).
 *
 * Acceptance criteria:
 *   Given a DSN, when an error is reported, then within 5 seconds one
 *   envelope is POSTed to /api/<project>/envelope/ with X-Sentry-Auth,
 *   carrying the class, frames, fingerprint, release, environment and
 *   workspace id tag, and no body, query string, cookie or header value.
 *   Given a signed-in member, when the page throws, then the server reports
 *   once with source browser and frames resolved to source files.
 *   Given no session, when anything POSTs to /api/client-errors, then it
 *   answers 204 and nothing is forwarded.
 *   Given any page, when its HTML and scripts are read, then neither the DSN
 *   nor the tracker's host appears in them.
 *
 * **How the error is forced (§10, settled in E1):** the spec throws in the
 * page, so no route that throws on demand exists in the product at all. The
 * thrown error's stack names one of the page's own chunks, which is what lets
 * this prove the server resolves a real build's frames through its source
 * maps.
 *
 * The application server is started with `OPENOKR_ERROR_DSN` pointing at
 * `e2e/tracker.ts`'s port, and this spec is what listens there.
 */
import { createServer, type Server } from "node:http";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";
import { TRACKER_KEY, TRACKER_PORT } from "./tracker.ts";

interface Received {
  readonly url: string;
  readonly auth: string;
  readonly envelope: string;
  readonly event: {
    readonly exception?: {
      readonly values?: readonly {
        readonly type?: string;
        readonly value?: string;
        readonly stacktrace?: {
          readonly frames?: readonly { readonly filename?: string }[];
        };
      }[];
    };
    readonly tags?: Readonly<Record<string, string>>;
    readonly release?: string;
    readonly environment?: string;
    readonly fingerprint?: readonly string[];
    readonly platform?: string;
  };
}

const received: Received[] = [];
let tracker: Server;

const fromBrowser = () =>
  received.filter((entry) => entry.event.tags?.source === "browser");

test.beforeAll(async () => {
  tracker = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const envelope = Buffer.concat(chunks).toString("utf8");
      const lines = envelope.split("\n");
      received.push({
        url: request.url ?? "",
        auth: String(request.headers["x-sentry-auth"] ?? ""),
        envelope,
        event: JSON.parse(lines[2] ?? "{}") as Received["event"],
      });
      response.writeHead(200).end();
    });
  });
  // Every interface, so `localhost` reaches it whether it resolves to the
  // IPv4 or the IPv6 loopback.
  await new Promise<void>((resolve) => tracker.listen(TRACKER_PORT, resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => tracker.close(() => resolve()));
});

test("a page's error reaches the tracker through our own server, frames resolved", async ({
  page,
}) => {
  await signIn(page);
  await goTo(page, "/");

  // Thrown in the page, with a stack naming one of the page's own chunks.
  await page.evaluate(() => {
    const chunk = [...document.scripts]
      .map((script) => script.src)
      .find((src) => src.includes("/_next/static/chunks/"));
    const error = new TypeError("e2e probe: Cannot read properties of null");
    error.stack = [
      `TypeError: ${error.message}`,
      `    at probe (${chunk ?? "missing"}:1:120)`,
      `    at ${chunk ?? "missing"}:1:40`,
    ].join("\n");
    window.dispatchEvent(new ErrorEvent("error", { error, message: error.message }));
  });

  // The server's queue sends every two seconds; D10 promises five.
  await expect.poll(() => fromBrowser().length, { timeout: 10_000 }).toBe(1);
  const [report] = fromBrowser();
  if (!report) {
    throw new Error("no report arrived");
  }

  expect(report.url).toBe("/api/1/envelope/");
  expect(report.auth).toContain(`sentry_key=${TRACKER_KEY}`);
  expect(report.event.platform).toBe("javascript");
  expect(report.event.environment).toBe("e2e");
  expect(report.event.release).toMatch(/^\d+\.\d+\.\d+/);
  expect(report.event.fingerprint?.[0]).toMatch(/^[0-9a-f]{32}$/);
  expect(report.event.tags?.workspace_id).toMatch(/^[0-9a-f-]{36}$/);

  const exception = report.event.exception?.values?.[0];
  expect(exception?.type).toBe("TypeError");
  // Withheld: a browser's message is the page's claim (§10, D6).
  expect(exception?.value).toBe("TypeError (message withheld)");
  const files = (exception?.stacktrace?.frames ?? []).map(
    (frame) => frame.filename ?? "",
  );
  expect(files.length).toBeGreaterThan(0);
  // Resolved through the build's source maps, not left as a chunk.
  expect(files.every((file) => !file.startsWith("_next/static/"))).toBe(true);

  // Nothing about the request: no address, no query, no cookie.
  expect(report.envelope).not.toContain("127.0.0.1");
  expect(report.envelope).not.toContain("e2e probe");
  const cookies = await page.context().cookies();
  for (const cookie of cookies) {
    if (cookie.value.length >= 8) {
      expect(report.envelope).not.toContain(cookie.value);
    }
  }
});

test("a report with no session answers 204 and goes nowhere", async ({
  playwright,
  baseURL,
}) => {
  const before = received.length;
  const anonymous = await playwright.request.newContext({ baseURL: baseURL ?? "" });
  const response = await anonymous.post("/api/client-errors", {
    data: {
      kind: "error",
      name: "TypeError",
      message: "x",
      stack: "TypeError: x\n    at f (https://a.example/_next/static/chunks/a.js:1:1)",
    },
  });
  expect(response.status()).toBe(204);
  await anonymous.dispose();
  // Longer than the queue's two seconds, so a report would have arrived.
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  expect(received.length).toBe(before);
});

test("no page or script names the DSN or the tracker's host", async ({ page }) => {
  await signIn(page);
  await goTo(page, "/");
  const html = await page.content();
  const scripts = await page.evaluate(() =>
    [...document.scripts].map((script) => script.src).filter(Boolean),
  );
  const bodies = await Promise.all(
    scripts.map(async (src) => (await page.request.get(src)).text()),
  );
  for (const text of [html, ...bodies]) {
    expect(text).not.toContain(TRACKER_KEY);
    expect(text).not.toContain(`localhost:${TRACKER_PORT}`);
  }
});
