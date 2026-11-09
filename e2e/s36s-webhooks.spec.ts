/**
 * Admin, Webhooks (docs/design/outbound-webhooks.md §3 and §6, plan 0.7.0 D5):
 * an administrator adds a webhook pointed at a receiver this spec runs, sees
 * its signing secret once, sends a test, and the receiver gets a POST whose
 * Standard Webhooks signature checks out against that secret. The delivery
 * then shows on the hook's page.
 *
 * The receiver listens on 127.0.0.1, which the outbound guard refuses unless
 * the instance allows private targets: `playwright.config.ts` starts the
 * application server with `OPENOKR_WEBHOOKS_ALLOW_PRIVATE` for this (Q1).
 * Withholding, retries, the turn-off after fifty failures and the purge are
 * proved in packages/core/test/webhook-delivery.test.ts.
 */
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

test.describe.configure({ mode: "serial" });

interface Received {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

let context: BrowserContext;
let page: Page;
let receiver: Server;
let address = "";
let secret = "";
const received: Received[] = [];
const NAME = `Webhook e2e ${Date.now()}`;

test.beforeAll(async ({ browser }) => {
  // A receiver on a port the system chooses, so it cannot collide with the
  // servers the suite runs.
  receiver = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      received.push({ headers: request.headers, body });
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) =>
    receiver.listen(0, "127.0.0.1", () => resolve()),
  );
  address = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

  context = await browser.newContext();
  page = await context.newPage();
  await signIn(page);
});

test.afterAll(async () => {
  await context?.close();
  await new Promise<void>((resolve) => receiver?.close(() => resolve()));
});

test("adds a webhook and shows its signing secret once", async () => {
  await goTo(page, "/admin/webhooks");
  await expect(page.getByRole("heading", { name: "Webhooks" })).toBeVisible();

  const form = page.getByTestId("webhook-create");
  await form.getByLabel("Name").fill(NAME);
  await form.getByLabel("Address").fill(address);
  await form.getByRole("checkbox", { name: "An objective is created" }).check();
  await form.getByRole("button", { name: "Add the webhook" }).click();

  const shown = page.getByTestId("webhook-secret");
  await expect(shown).toBeVisible({ timeout: 10_000 });
  await expect(shown).toContainText("You will not see this again");
  secret = ((await shown.locator("code").textContent()) ?? "").trim();
  expect(secret).toMatch(/^whsec_/);

  // Once: the list never carries it, and a reload does not bring it back.
  await page.reload();
  await expect(page.getByTestId("webhook-secret")).toHaveCount(0);
  await expect(page.getByText(secret)).toHaveCount(0);
  await expect(
    page.getByTestId("webhook-row").filter({ hasText: NAME }),
  ).toBeVisible();
});

test("sends a signed test the receiver can verify, and logs the delivery", async () => {
  await page
    .getByTestId("webhook-row")
    .filter({ hasText: NAME })
    .getByRole("link", { name: NAME })
    .click();
  await expect(page.getByRole("heading", { name: NAME })).toBeVisible();

  await page.getByRole("button", { name: "Send test" }).click();
  await expect(page.getByText("A test is on its way")).toBeVisible();

  // The relay sends it after the write commits, on its next poll.
  await expect
    .poll(() => received.length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  const [hit] = received as [Received];
  const id = String(hit.headers["webhook-id"]);
  const timestamp = String(hit.headers["webhook-timestamp"]);
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${hit.body}`)
    .digest("base64");
  expect(String(hit.headers["webhook-signature"]).split(" ")).toContain(
    `v1,${expected}`,
  );
  expect(hit.headers["content-type"]).toBe("application/json");
  expect(JSON.parse(hit.body)).toMatchObject({
    id,
    type: "ping",
    data: {},
  });

  // The attempt is on the hook's page, and nothing of the body is.
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByTestId("webhook-delivery").count();
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
  const delivery = page.getByTestId("webhook-delivery").first();
  await expect(delivery).toContainText("Test");
  await expect(delivery).toContainText("Delivered 200");
  await expect(delivery).toContainText("attempt 1");
});
