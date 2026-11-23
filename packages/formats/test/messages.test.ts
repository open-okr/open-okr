import { describe, expect, test } from "vitest";
import { messageHoles, translate } from "../src/messages.ts";

describe("message engine and plurals", () => {
  test("named holes are substituted", () => {
    const catalogue = {
      greeting: "Hello, {name}!",
    };
    expect(translate(catalogue, "greeting", { name: "Alice" })).toBe(
      "Hello, Alice!",
    );
  });

  test("Arabic six categories select correctly", () => {
    const catalogue = {
      "items.zero": "صفر عناصر",
      "items.one": "عنصر واحد",
      "items.two": "عنصران",
      "items.few": "{count} عناصر قليلة",
      "items.many": "{count} عنصراً كثيراً",
      "items.other": "{count} عنصر",
    };

    // ar locale: 0=zero, 1=one, 2=two, 3..10=few, 11..99=many, 100=other
    expect(translate(catalogue, "items", { count: 0 }, undefined, "ar")).toBe(
      "صفر عناصر",
    );
    expect(translate(catalogue, "items", { count: 1 }, undefined, "ar")).toBe(
      "عنصر واحد",
    );
    expect(translate(catalogue, "items", { count: 2 }, undefined, "ar")).toBe(
      "عنصران",
    );
    expect(translate(catalogue, "items", { count: 3 }, undefined, "ar")).toBe(
      "3 عناصر قليلة",
    );
    expect(translate(catalogue, "items", { count: 11 }, undefined, "ar")).toBe(
      "11 عنصراً كثيراً",
    );
    expect(translate(catalogue, "items", { count: 100 }, undefined, "ar")).toBe(
      "100 عنصر",
    );
  });

  test("a missing category falls back to other and never throws", () => {
    const catalogue = {
      "items.other": "{count} items",
    };
    // In English or Arabic, if .one or .few is missing, it falls back to .other
    expect(translate(catalogue, "items", { count: 1 }, undefined, "en")).toBe(
      "1 items",
    );
    expect(translate(catalogue, "items", { count: 3 }, undefined, "ar")).toBe(
      "3 items",
    );
  });

  test("What fills {{{placeholder}}} renders", () => {
    const catalogue = {
      template: "What fills {{{placeholder}}}",
    };
    expect(translate(catalogue, "template", { placeholder: "title" })).toBe(
      "What fills {{title}}",
    );
  });

  test("messageHoles extracts named holes", () => {
    expect(messageHoles("Hello {name}, you have {count} messages")).toEqual([
      "name",
      "count",
    ]);
  });
});
