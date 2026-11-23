import { OBJECTIVE_CHECKS } from "@openokr/method";
import { translate } from "@openokr/ui";
import { CATALOGUES } from "@openokr/ui/catalogues";
import { renderToReadableStream } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { methodPromptText } from "../lib/method-words.ts";

vi.mock("../lib/translations", () => ({
  getTranslations: async () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      translate(CATALOGUES.ms, key, values),
  }),
}));

const { default: RulePage } = await import("../app/method/[id]/page");
const t = (key: string) => translate(CATALOGUES.ms, key);

it("shows the Malay title, condition and prompt on a rule page", async () => {
  const element = await RulePage({ params: Promise.resolve({ id: "OBJ-1" }) });
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  const html = await new Response(stream).text();
  expect(html).toContain("Hasil, bukan keluaran");
  expect(html).not.toContain("Outcome, not output");
  expect(html).toContain("Bermula dengan kata kerja keluaran");
  expect(html).toContain(
    "Objektif anda bermula dengan sesuatu yang hendak diserahkan",
  );
});

it("finds a chip's English prompt again and shows the Malay one", () => {
  const english = OBJECTIVE_CHECKS[0]?.conditions[0]?.prompt ?? "";
  expect(english).not.toBe("");
  const shown = methodPromptText(t, "OBJ-1", english);
  expect(shown).not.toBe(english);
  expect(methodPromptText(t, "OBJ-1", "Hasil, bukan keluaran")).toBe(
    "Hasil, bukan keluaran",
  );
  expect(methodPromptText(t, "OBJ-1", "Outcome, not output")).toBe(
    "Hasil, bukan keluaran",
  );
});
