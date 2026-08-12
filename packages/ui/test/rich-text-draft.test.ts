import { describe, expect, test } from "vitest";
import {
  createDraft,
  draftStorageKey,
  fingerprint,
  isDraftUsable,
} from "../src/rich-text/draft.ts";

describe("fingerprint", () => {
  test("is the same for structurally identical content, regardless of object identity", () => {
    const a = { type: "doc", content: [{ type: "paragraph" }] };
    const b = { type: "doc", content: [{ type: "paragraph" }] };
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  test("differs when content actually differs", () => {
    const a = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }],
    };
    const b = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }],
    };
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });
});

describe("draftStorageKey", () => {
  test("is namespaced per entity and member", () => {
    expect(draftStorageKey("comment", "entity-1", "member-1")).toBe(
      "openokr:draft:comment:entity-1:member-1",
    );
  });
});

describe("isDraftUsable — a draft against changed base content does not resurrect", () => {
  const base = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "original" }] },
    ],
  };
  const edited = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "in progress" }] },
    ],
  };

  test("usable when fresh and the base content is unchanged", () => {
    const draft = createDraft(edited, base, 1_000);
    expect(isDraftUsable(draft, base, 1_500)).toBe(true);
  });

  test("not usable once the base content has changed underneath it", () => {
    const draft = createDraft(edited, base, 1_000);
    const changedBase = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "someone else edited this" }],
        },
      ],
    };
    expect(isDraftUsable(draft, changedBase, 1_500)).toBe(false);
  });

  test("not usable once it has expired, even against the same base content", () => {
    const draft = createDraft(edited, base, 0, 1000);
    expect(isDraftUsable(draft, base, 999)).toBe(true);
    expect(isDraftUsable(draft, base, 1000)).toBe(false);
  });
});
