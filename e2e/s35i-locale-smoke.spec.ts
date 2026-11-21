import { expect, test } from "./fixtures.ts";
import { goTo, signIn } from "./instance-account.ts";

const LOCALES = [
  { code: "ms", home: "Utama" },
  { code: "zh-Hans", home: "首页" },
  { code: "es", home: "Inicio" },
] as const;

test("an English sign-in loads only its own catalogue", async ({ page }) => {
  const chunks: Promise<string>[] = [];
  page.on("response", (response) => {
    if (response.ok() && response.request().resourceType() === "script") {
      chunks.push(response.text());
    }
  });
  await page.setExtraHTTPHeaders({ "Accept-Language": "en" });
  await page.goto("/sign-in");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  const scripts = (await Promise.all(chunks)).join("\n");
  expect(scripts).toContain("Add role");
  expect(scripts.includes("Añadir rol"), "Spanish catalogue").toBe(false);
  expect(scripts.includes("添加角色"), "Chinese catalogue").toBe(false);
});

for (const { code, home } of LOCALES) {
  test(`the member opens Home in ${code}`, async ({ page }, testInfo) => {
    await signIn(page);
    await goTo(page, "/account");
    const language = page.getByTestId("member-language");
    await expect(language.locator(`option[value="${code}"]`)).toHaveCount(1);
    await language.selectOption(code);
    await expect(page.locator("html")).toHaveAttribute("lang", code);

    try {
      await goTo(page, "/");
      await expect(page.locator("html")).toHaveAttribute("lang", code);
      await expect(
        page.getByRole("link", { name: home, exact: true }).first(),
      ).toBeVisible();

      if (code === "zh-Hans") {
        // Interception disables the HTTP cache so each page's downloads count.
        await page.route("**/fonts/noto-sans-sc/**", (route) => route.continue());
        const files = new Set<string>();
        page.on("requestfinished", (request) => {
          const path = new URL(request.url()).pathname;
          if (path.startsWith("/fonts/noto-sans-sc/") && path.endsWith(".woff2")) {
            files.add(path);
          }
        });

        for (const [screen, path] of [
          ["Home", "/"],
          ["OKRs", "/goals"],
          ["Check-in", "/check-in"],
        ]) {
          files.clear();
          await goTo(page, path);
          await page.waitForLoadState("load");
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          await expect(page.locator("html")).toHaveAttribute("lang", code);
          expect(files.size, `${screen} downloads Han font slices`).toBeGreaterThan(
            0,
          );
          const filenames = [...files]
            .map((name) => name.split("/").at(-1))
            .sort();
          console.log(
            `AC-29 ${screen}: ${filenames.length} Han font slices (${filenames.join(", ")})`,
          );
          await testInfo.attach(`Han font slices on ${screen}`, {
            body: JSON.stringify(filenames),
            contentType: "application/json",
          });
          const screenshot = testInfo.outputPath(`zh-Hans-${screen}.png`);
          await page.screenshot({ path: screenshot });
          await testInfo.attach(`Simplified Chinese ${screen}`, {
            path: screenshot,
            contentType: "image/png",
          });
        }
      }
    } finally {
      await goTo(page, "/account");
      await language.selectOption("");
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
    }
  });
}
