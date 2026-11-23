import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect } from "./fixtures.ts";
import { goTo } from "./instance-account.ts";

export async function selectMemberArabic(page: Page, enabled: boolean) {
  await goTo(page, "/account");
  const language = page.getByTestId("member-language");
  const value = enabled ? "ar" : "";
  await expect(language.locator(`option[value="${value}"]`)).toHaveCount(1);
  await language.selectOption(value);
  await expect(page.locator("html")).toHaveAttribute(
    "lang",
    enabled ? "ar" : "en",
  );
  await expect(page.locator("html")).toHaveAttribute(
    "dir",
    enabled ? "rtl" : "ltr",
  );
}

export function readArabicLabels(): Readonly<Record<string, string>> {
  return JSON.parse(
    readFileSync(
      new URL("../packages/ui/src/i18n/messages/ar.json", import.meta.url),
      "utf8",
    ),
  );
}
