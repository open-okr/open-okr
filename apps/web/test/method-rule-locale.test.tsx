import {
  CLOSE_DECISION_MEANINGS,
  GATE_TITLES,
  MANAGEMENT_RETRO_QUESTIONS,
  OBJECTIVE_CHECKS,
  PHASE_GUIDANCE,
  PROCESS_HEALTH_STATEMENTS,
  REVIEW_STAGES,
  ROOT_CAUSES,
  TRIGGER_CATALOGUE,
  WEEKLY_STEPS,
} from "@openokr/method";
import { translate } from "@openokr/ui";
import { CATALOGUES } from "@openokr/ui/catalogues";
import { renderToReadableStream } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { TRIGGER_NAME_KEYS } from "../lib/identifier-names.ts";
import {
  closeDecisionMeaning,
  gateTitle,
  managementRetroQuestion,
  managementRetroQuestionText,
  phaseGuidance,
  phaseOutput,
  phaseTitle,
  processHealthStatement,
  processHealthStatementText,
  reviewStagePurpose,
  reviewStageTitle,
  rootCause,
  rootCauseText,
  triggerFires,
  triggerRecipient,
  weeklyStepPurpose,
  weeklyStepTitle,
} from "../lib/method-texts.ts";
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

it("keys every phase, gate, stage, statement and trigger text the package has", () => {
  // D5b: one key per entry, and English equal to the package, so a new phase,
  // stage or trigger cannot reach a screen untranslated.
  const en = (key: string) => translate(CATALOGUES.en, key);
  for (const entry of PHASE_GUIDANCE) {
    expect(phaseTitle(en, entry.phase)).toBe(entry.title);
    expect(phaseOutput(en, entry.phase)).toBe(entry.output);
  }
  GATE_TITLES.forEach((title, index) => {
    expect(gateTitle(en, index + 1)).toBe(title);
  });
  for (const step of WEEKLY_STEPS) {
    expect(weeklyStepTitle(en, step.step)).toBe(step.title);
    expect(weeklyStepPurpose(en, step.step)).toBe(step.purpose);
  }
  for (const stage of REVIEW_STAGES) {
    expect(reviewStageTitle(en, stage.stage)).toBe(stage.title);
    expect(reviewStagePurpose(en, stage.stage)).toBe(stage.purpose);
  }
  PROCESS_HEALTH_STATEMENTS.forEach((statement, index) => {
    expect(processHealthStatement(en, index + 1)).toBe(statement);
  });
  for (const rule of TRIGGER_CATALOGUE) {
    expect(triggerFires(en, rule.key, "")).toBe(rule.fires);
    expect(triggerRecipient(en, rule.key, "")).toBe(rule.recipient);
  }
});

it("shows the Malay phase, gate, stage, statement and trigger words", () => {
  expect(phaseTitle(t, 6)).toBe("Jalankan irama");
  expect(gateTitle(t, 6)).toBe(
    "Tarikh penerbitan ditetapkan sebelum hari pertama Kitaran",
  );
  expect(reviewStageTitle(t, 1)).toBe("Buka dan sapaan");
  const statement = PROCESS_HEALTH_STATEMENTS[0] ?? "";
  expect(processHealthStatementText(t, statement)).not.toBe(statement);
  expect(processHealthStatementText(t, "Not a statement")).toBe(
    "Not a statement",
  );
  expect(triggerRecipient(t, "checkin.due", "Owner")).toBe("Pemilik");
  expect(triggerFires(t, "no.such.rule", "As written")).toBe("As written");
});

it("keys every root cause, retro question, close meaning, guidance line and trigger name", () => {
  // 0.10.1: what D5b left English, held to the package the same way.
  const en = (key: string) => translate(CATALOGUES.en, key);
  ROOT_CAUSES.forEach((cause, index) => {
    expect(rootCause(en, index + 1, "")).toBe(cause);
  });
  MANAGEMENT_RETRO_QUESTIONS.forEach((question, index) => {
    expect(managementRetroQuestion(en, index + 1, "")).toBe(question);
  });
  for (const [decision, meaning] of Object.entries(CLOSE_DECISION_MEANINGS)) {
    expect(closeDecisionMeaning(en, decision, "")).toBe(meaning);
  }
  for (const entry of PHASE_GUIDANCE) {
    expect(
      phaseGuidance(
        en,
        entry.phase,
        entry.guidance.map(() => ""),
      ),
    ).toEqual(entry.guidance);
  }
  for (const rule of TRIGGER_CATALOGUE) {
    const key = TRIGGER_NAME_KEYS[rule.key];
    expect(key && en(key)).toBe(rule.title);
  }
});

it("shows the Malay root causes, retro questions, close meanings and guidance", () => {
  expect(rootCause(t, 3, "Blocked by a dependency")).toBe(
    "Disekat oleh kebergantungan",
  );
  expect(rootCauseText(t, ROOT_CAUSES[0] ?? "")).toBe(
    "Cita-cita ditetapkan terlalu tinggi",
  );
  expect(rootCauseText(t, "Not a cause")).toBe("Not a cause");
  expect(
    managementRetroQuestionText(t, MANAGEMENT_RETRO_QUESTIONS[3] ?? ""),
  ).toBe("Di manakah penjajaran terputus?");
  expect(closeDecisionMeaning(t, "achieved", "Done. Close it")).toBe(
    "Selesai. Tutupnya",
  );
  expect(closeDecisionMeaning(t, "unknown", "As written")).toBe("As written");
  expect(phaseGuidance(t, 2, ["", "", ""])[0]).toBe(
    "Pastikan pemarkahan berasaskan fakta",
  );
  expect(phaseGuidance(t, 99, ["As written"])).toEqual(["As written"]);
});
