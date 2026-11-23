/**
 * Locale catalogue bundle size and isolation (AC-6, plan 0.10.0 S2).
 *
 * An English visitor loads client chunks containing only the English catalogue
 * and no other language's catalogue.
 */
import { expect, test } from "./fixtures.ts";

test.describe("locale catalogue bytes (AC-6)", () => {
  test.use({ locale: "en-GB" });

  test("/sign-in with Accept-Language: en loads en catalogue and no ms-only strings", async ({
    page,
  }) => {
    const scripts: { url: string; text: string; size: number }[] = [];

    page.on("response", async (response) => {
      const url = response.url();
      if (
        (response.request().resourceType() === "script" || url.endsWith(".js")) &&
        response.status() === 200
      ) {
        try {
          const body = await response.body();
          scripts.push({
            url,
            text: body.toString("utf-8"),
            size: body.length,
          });
        } catch {
          // ignore aborted or opaque responses
        }
      }
    });

    await page.goto("/sign-in");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    // Known English string and known Malay-only string from catalogue
    const knownEn = "Too many attempts for this address.";
    const msOnly = "Terlalu banyak percubaan untuk alamat ini.";

    const allScriptText = scripts.map((s) => s.text).join("\n");
    expect(allScriptText).toContain(knownEn);
    expect(allScriptText).not.toContain(msOnly);

    // Find the chunk containing the catalogue and print transferred bytes
    const catalogueChunk = scripts.find((s) => s.text.includes(knownEn));
    const transferredBytes = catalogueChunk ? catalogueChunk.size : 0;
    console.log(`Transferred EN catalogue chunk bytes: ${transferredBytes}`);
    expect(transferredBytes).toBeGreaterThan(0);
  });
});
