import { describe, expect, it } from "vitest";
import { resolveChannelTemplate } from "../src/channels/template-mappings.ts";
import { getServerCatalogue, serverTranslate } from "../src/i18n/catalogue.ts";
import {
  renderDigest,
  renderMentionNotification,
} from "../src/notifications/templates.ts";

describe("server catalogue (languages §13, 0.10.0 S6)", () => {
  describe("catalogue parity", () => {
    it("provides parity between English and Malay server catalogues", () => {
      const en = getServerCatalogue("en");
      const ms = getServerCatalogue("ms");

      const enKeys = Object.keys(en).sort();
      const msKeys = Object.keys(ms).sort();

      expect(msKeys).toEqual(enKeys);
      expect(enKeys.length).toBeGreaterThan(190);

      // Verify holes match
      const holeRegex = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;
      for (const key of enKeys) {
        const enHoles = [...(en[key]?.matchAll(holeRegex) ?? [])]
          .map((m) => m[1])
          .sort();
        const msHoles = [...(ms[key]?.matchAll(holeRegex) ?? [])]
          .map((m) => m[1])
          .sort();
        expect(msHoles, `Holes mismatch for key ${key}`).toEqual(enHoles);
      }
    });

    it("translates server keys accurately with holes", () => {
      expect(serverTranslate("en", "reset.subject", { instance: "Acme" })).toBe(
        "Reset your Acme password",
      );
      expect(serverTranslate("ms", "reset.subject", { instance: "Acme" })).toBe(
        "Tetapkan semula kata laluan Acme anda",
      );
    });
  });

  describe("AC-26: per-recipient notification rendering", () => {
    it("renders mention notification in recipient's resolved locale from one event", () => {
      const input = {
        actorName: "Sarah",
        subjectTitle: "Increase retention",
        link: "https://example.com/goals/123",
      };

      // Recipient A: ms (standing in for pt in AC-26)
      const renderA = renderMentionNotification(input, "ms");
      expect(renderA.subject).toBe(
        'Sarah menyebut anda dalam "Increase retention"',
      );
      expect(renderA.text).toContain("Sarah menyebut anda");
      expect(renderA.html).toContain("Buka");

      // Recipient B: en (standing in for it in AC-26)
      const renderB = renderMentionNotification(input, "en");
      expect(renderB.subject).toBe(
        'Sarah mentioned you in "Increase retention"',
      );
      expect(renderB.text).toContain("Sarah mentioned you");
      expect(renderB.html).toContain("Open it");
    });

    it("renders digest mail in recipient's resolved locale", () => {
      const input = {
        items: [
          { summary: "Goal updated", link: "https://example.com/goals/1" },
          { summary: "KPI updated", link: "https://example.com/kpis/2" },
        ],
      };

      const digestA = renderDigest(input, "ms");
      expect(digestA.subject).toBe("2 kemas kini");

      const digestB = renderDigest(input, "en");
      expect(digestB.subject).toBe("2 updates");
    });
  });

  describe("channel template resolution and fallback", () => {
    it("matches recipient locale when approved template exists, falls back to workspace language", () => {
      const templates = [
        { name: "checkin_due", language: "en", status: "APPROVED" },
        { name: "checkin_due", language: "ms", status: "APPROVED" },
      ];

      // Recipient with ms gets ms template
      const resolvedMs = resolveChannelTemplate({
        templates,
        templateName: "checkin_due",
        recipientLocale: "ms",
        workspaceLanguage: "en",
      });
      expect(resolvedMs?.language).toBe("ms");

      // Recipient with de (no de template) falls back to workspaceLanguage (en)
      const resolvedDe = resolveChannelTemplate({
        templates,
        templateName: "checkin_due",
        recipientLocale: "de",
        workspaceLanguage: "en",
      });
      expect(resolvedDe?.language).toBe("en");
    });
  });
});
