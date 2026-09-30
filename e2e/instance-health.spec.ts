/**
 * The instance runs the way the product is designed to (completeness review
 * H-01, H-02).
 *
 * These servers have always connected as the restricted application role, and
 * until this spec every one of them logged "scheduler: could not start:
 * permission denied for database" and carried on. No browser test had ever
 * run with a live scheduler, and the Compose install, which connected as a
 * superuser, had the opposite problem: a scheduler, and no tenant floor.
 * Neither showed in any check. The health endpoint reports both now, and this
 * holds both at once against a real server.
 */
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

let api: APIRequestContext;

test.beforeAll(async ({ playwright, baseURL }) => {
  api = await playwright.request.newContext({ baseURL });
});

test.afterAll(async () => {
  await api?.dispose();
});

test("the scheduler starts under a role the tenant floor binds", async () => {
  // The scheduler starts in the background after boot, so the answer is
  // polled rather than read once.
  await expect
    .poll(
      async () => {
        const response = await api.get("/api/health");
        return (await response.json()) as Record<string, unknown>;
      },
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toEqual({ status: "ok", scheduler: "running", tenantFloor: "enforced" });
});

test("the status page counts the scheduler as operational", async () => {
  const response = await api.get("/api/status");
  const body = (await response.json()) as {
    components: { scheduler: { status: string } };
  };
  expect(body.components.scheduler.status).toBe("operational");
});

test("the tab has an icon, so no page asks for one that is missing", async () => {
  // Completeness review L-09: /favicon.ico answered 404 on every page, which
  // is a line in every access log and a blank square in every tab.
  const ico = await api.get("/favicon.ico");
  expect(ico.status()).toBe(200);
  expect(ico.headers()["content-type"]).toMatch(/icon/);
  const svg = await api.get("/icon.svg");
  expect(svg.status()).toBe(200);
  expect(svg.headers()["content-type"]).toMatch(/svg/);
});
