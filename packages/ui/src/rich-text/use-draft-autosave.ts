"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createDraft,
  type DraftRecord,
  draftStorageKey,
  isDraftUsable,
} from "./draft.ts";

export interface UseDraftAutosaveOptions {
  readonly entityType: string;
  readonly entityId: string;
  readonly memberId: string;
  /** The content the editor was initialised with — the draft's own
   * fingerprint is checked against this, not against whatever the editor
   * currently holds. */
  readonly baseContent: unknown;
  readonly debounceMs?: number;
  readonly now?: () => number;
}

export interface UseDraftAutosaveResult {
  /** The recovered draft, or `null` if none exists, has expired, or its
   * base content no longer matches — read once, on mount. A host that
   * gets a non-null value here decides whether to load it into the
   * editor; this hook does not do that itself, since it has no reference
   * to the editor instance. */
  readonly recoveredDraft: unknown | null;
  save(content: unknown): void;
  clearDraft(): void;
}

export function useDraftAutosave({
  entityType,
  entityId,
  memberId,
  baseContent,
  debounceMs = 2000,
  now = Date.now,
}: UseDraftAutosaveOptions): UseDraftAutosaveResult {
  const key = draftStorageKey(entityType, entityId, memberId);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const [recoveredDraft] = useState<unknown | null>(() => {
    if (typeof window === "undefined") {
      return null;
    }
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    try {
      const draft = JSON.parse(raw) as DraftRecord;
      if (isDraftUsable(draft, baseContent, now())) {
        return draft.content;
      }
      window.localStorage.removeItem(key);
      return null;
    } catch {
      window.localStorage.removeItem(key);
      return null;
    }
  });

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const save = useCallback(
    (content: unknown) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        const draft = createDraft(content, baseContent, now());
        window.localStorage.setItem(key, JSON.stringify(draft));
      }, debounceMs);
    },
    [key, baseContent, debounceMs, now],
  );

  const clearDraft = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    window.localStorage.removeItem(key);
  }, [key]);

  return { recoveredDraft, save, clearDraft };
}
