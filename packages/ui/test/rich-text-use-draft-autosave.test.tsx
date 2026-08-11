import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { draftStorageKey } from "../src/rich-text/draft.ts";
import { useDraftAutosave } from "../src/rich-text/use-draft-autosave.ts";

const BASE = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "base" }] }],
};
const EDITED = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "edited" }] }],
};

afterEach(() => {
  window.localStorage.clear();
});

describe("useDraftAutosave", () => {
  test("recoveredDraft is null when nothing was ever saved", () => {
    const { result } = renderHook(() =>
      useDraftAutosave({
        entityType: "comment",
        entityId: "e1",
        memberId: "m1",
        baseContent: BASE,
      }),
    );
    expect(result.current.recoveredDraft).toBeNull();
  });

  test("save() writes to localStorage after the debounce, and recoveredDraft on a fresh mount reads it back", async () => {
    const { result } = renderHook(() =>
      useDraftAutosave({
        entityType: "comment",
        entityId: "e1",
        memberId: "m1",
        baseContent: BASE,
        debounceMs: 10,
      }),
    );
    act(() => {
      result.current.save(EDITED);
    });
    await waitFor(() => {
      expect(
        window.localStorage.getItem(draftStorageKey("comment", "e1", "m1")),
      ).not.toBeNull();
    });

    const { result: secondMount } = renderHook(() =>
      useDraftAutosave({
        entityType: "comment",
        entityId: "e1",
        memberId: "m1",
        baseContent: BASE,
      }),
    );
    expect(secondMount.current.recoveredDraft).toEqual(EDITED);
  });

  test("a draft against changed base content does not resurrect on mount", async () => {
    const { result } = renderHook(() =>
      useDraftAutosave({
        entityType: "comment",
        entityId: "e1",
        memberId: "m1",
        baseContent: BASE,
        debounceMs: 10,
      }),
    );
    act(() => {
      result.current.save(EDITED);
    });
    await waitFor(() => {
      expect(
        window.localStorage.getItem(draftStorageKey("comment", "e1", "m1")),
      ).not.toBeNull();
    });

    const changedBase = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "someone else's edit" }],
        },
      ],
    };
    const { result: secondMount } = renderHook(() =>
      useDraftAutosave({
        entityType: "comment",
        entityId: "e1",
        memberId: "m1",
        baseContent: changedBase,
      }),
    );
    expect(secondMount.current.recoveredDraft).toBeNull();
    // Discarded, not just ignored: a stale draft does not linger for a
    // third mount to accidentally read back once the base content
    // matches again by coincidence.
    expect(
      window.localStorage.getItem(draftStorageKey("comment", "e1", "m1")),
    ).toBeNull();
  });

  test("clearDraft removes it immediately, cancelling any pending debounced save", async () => {
    const { result } = renderHook(() =>
      useDraftAutosave({
        entityType: "comment",
        entityId: "e1",
        memberId: "m1",
        baseContent: BASE,
        debounceMs: 50,
      }),
    );
    act(() => {
      result.current.save(EDITED);
      result.current.clearDraft();
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(
      window.localStorage.getItem(draftStorageKey("comment", "e1", "m1")),
    ).toBeNull();
  });
});
