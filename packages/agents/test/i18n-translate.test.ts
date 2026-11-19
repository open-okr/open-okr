import { MockAIProvider } from "@openokr/adapters";
import { describe, expect, it } from "vitest";
import {
  chunkKeys,
  maskHoles,
  translateCatalogue,
  unmaskHoles,
  validateTranslation,
} from "../src/i18n-translate.ts";

describe("i18n translate", () => {
  describe("masking round trip", () => {
    it("masks holes into numbered tokens and unmasks them accurately", () => {
      const source = "You have {count} days left until {date}.";
      const { masked, tokens } = maskHoles(source);
      expect(masked).toBe("You have ⟦1⟧ days left until ⟦2⟧.");
      expect(tokens.get("⟦1⟧")).toBe("{count}");
      expect(tokens.get("⟦2⟧")).toBe("{date}");

      const translation = "Anda mempunyai ⟦1⟧ hari lagi sehingga ⟦2⟧.";
      const unmasked = unmaskHoles(translation, tokens);
      expect(unmasked.success).toBe(true);
      expect(unmasked.text).toBe(
        "Anda mempunyai {count} hari lagi sehingga {date}.",
      );
    });

    it("allows swapped hole order in translation", () => {
      const source = "On {date}, {count} events occurred.";
      const { masked, tokens } = maskHoles(source);
      expect(masked).toBe("On ⟦1⟧, ⟦2⟧ events occurred.");

      // Swapped order: ⟦2⟧ first, then ⟦1⟧
      const translation = "Es gab ⟦2⟧ Ereignisse am ⟦1⟧.";
      const unmasked = unmaskHoles(translation, tokens);
      expect(unmasked.success).toBe(true);
      expect(unmasked.text).toBe("Es gab {count} Ereignisse am {date}.");
    });

    it("detects dropped hole token", () => {
      const source = "Delete {count} items";
      const { tokens } = maskHoles(source);
      const dropped = "Padam item";
      const res = unmaskHoles(dropped, tokens);
      expect(res.success).toBe(false);
      expect(res.error).toContain("dropped hole token ⟦1⟧");
    });

    it("detects duplicated hole token", () => {
      const source = "Delete {count} items";
      const { tokens } = maskHoles(source);
      const duplicated = "Padam ⟦1⟧ daripada ⟦1⟧ item";
      const res = unmaskHoles(duplicated, tokens);
      expect(res.success).toBe(false);
      expect(res.error).toContain("duplicate hole token ⟦1⟧");
    });

    it("detects unexpected hole token", () => {
      const source = "Delete item";
      const { tokens } = maskHoles(source);
      const unexpected = "Padam ⟦1⟧ item";
      const res = unmaskHoles(unexpected, tokens);
      expect(res.success).toBe(false);
      expect(res.error).toContain("unexpected hole token ⟦1⟧");
    });
  });

  describe("length and script checks", () => {
    it("fails when translated text exceeds 3x English length", () => {
      const english = "Hello world"; // 11 chars -> max 33
      const longTranslation = "A".repeat(34);
      const res = validateTranslation(
        "greeting",
        english,
        longTranslation,
        "de",
      );
      expect(res.valid).toBe(false);
      expect(res.error).toContain("exceeds 3 times English length");
    });

    it("passes when translated text is within 3x English length", () => {
      const english = "Hello world";
      const validTranslation = "Hallo Welt";
      const res = validateTranslation(
        "greeting",
        english,
        validTranslation,
        "de",
      );
      expect(res.valid).toBe(true);
    });

    it("fails when zh-Hans translation contains Latin letters but no Han character", () => {
      const english = "Welcome to the workspace";
      const invalidTranslation = "Welcome workspace";
      const res = validateTranslation(
        "welcome",
        english,
        invalidTranslation,
        "zh-Hans",
      );
      expect(res.valid).toBe(false);
      expect(res.error).toContain(
        "Chinese translation contains no Han characters",
      );
    });

    it("passes when zh-Hans translation contains Han characters", () => {
      const english = "Welcome to the workspace";
      const validTranslation = "欢迎来到工作区";
      const res = validateTranslation(
        "welcome",
        english,
        validTranslation,
        "zh-Hans",
      );
      expect(res.valid).toBe(true);
    });

    it("passes zh-Hans Latin letters when listed in same-as-english", () => {
      const english = "OpenOKR";
      const res = validateTranslation("brand", english, "OpenOKR", "zh-Hans", {
        brand: "Product brand name",
      });
      expect(res.valid).toBe(true);
    });

    it("fails when ar translation contains Latin letters but no Arabic character", () => {
      const english = "Settings";
      const invalidTranslation = "Settings";
      const res = validateTranslation(
        "nav.settings",
        english,
        invalidTranslation,
        "ar",
      );
      expect(res.valid).toBe(false);
      expect(res.error).toContain(
        "Arabic translation contains no Arabic characters",
      );
    });

    it("passes when ar translation contains Arabic characters", () => {
      const english = "Settings";
      const validTranslation = "الإعدادات";
      const res = validateTranslation(
        "nav.settings",
        english,
        validTranslation,
        "ar",
      );
      expect(res.valid).toBe(true);
    });
  });

  describe("batches of at most 100 keys", () => {
    it("splits keys into chunks of at most 100", () => {
      const keys = Array.from({ length: 250 }, (_, i) => `key.${i}`);
      const chunks = chunkKeys(keys, 100);
      expect(chunks.length).toBe(3);
      expect(chunks[0]?.length).toBe(100);
      expect(chunks[1]?.length).toBe(100);
      expect(chunks[2]?.length).toBe(50);
    });
  });

  describe("AC-10: dropped hole token handling", () => {
    it("leaves key in pending.json and reports it when reply drops hole token", async () => {
      // Setup mock provider that drops hole token for 'warning.overdue'
      const mockReply = JSON.stringify({
        "warning.normal": "Warnung normal",
        "warning.overdue": "Überfällig", // English was "Overdue by ⟦1⟧ days", so ⟦1⟧ is dropped!
      });

      const provider = new MockAIProvider({
        chatResponse: {
          content: mockReply,
          usage: { inputTokens: 50, outputTokens: 30 },
        },
      });

      const sourceCatalogue = {
        "warning.normal": "Normal warning",
        "warning.overdue": "Overdue by {count} days",
      };

      const targetCatalogue: Record<string, string> = {
        "warning.normal": "Normal warning",
        "warning.overdue": "Overdue by {count} days",
      };

      const pendingKeys = ["warning.normal", "warning.overdue"];

      const result = await translateCatalogue({
        provider,
        model: "mock-model",
        locale: "de",
        keys: ["warning.normal", "warning.overdue"],
        sourceCatalogue,
        targetCatalogue,
        pendingKeys,
        sameAsEnglish: {},
      });

      // Successful key is updated and removed from pending
      expect(result.translatedCount).toBe(1);
      expect(targetCatalogue["warning.normal"]).toBe("Warnung normal");
      expect(result.remainingPending).not.toContain("warning.normal");

      // Failed key with dropped hole token stays in pending and is reported
      expect(result.failedCount).toBe(1);
      expect(result.failures[0]?.key).toBe("warning.overdue");
      expect(result.failures[0]?.error).toContain("dropped hole token ⟦1⟧");
      expect(result.remainingPending).toContain("warning.overdue");
      // Target catalogue retains original value, never corrupted with dropped hole
      expect(targetCatalogue["warning.overdue"]).toBe(
        "Overdue by {count} days",
      );
    });
  });
});
