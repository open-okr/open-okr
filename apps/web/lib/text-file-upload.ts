"use client";

import { type UploadedFile, useTranslations } from "@openokr/ui";
import { useCallback, useMemo, useState } from "react";
import type { TextFileResult } from "./attachment-actions.ts";

/** The server action that stores a file for the text: `uploadTextFile`. */
export type StoreTextFile = (formData: FormData) => Promise<TextFileResult>;

/**
 * The editor's `uploadFile`, and what to say when an upload fails (plan 0.7.0
 * R4, rich-text-editor.md §7).
 *
 * The editor removes a node whose upload fails rather than leave it pointing
 * at nothing, which on its own would make a pasted file vanish without a word.
 * So the refusal is kept here for the field to show beside itself, and the
 * promise still rejects, which is what tells the editor to take the node out.
 *
 * Undefined when the host gives no way to store a file, so the editor treats
 * a paste or a drop as it always did.
 */
export function useTextFileUpload(store: StoreTextFile | undefined): {
  readonly uploadFile: ((file: File) => Promise<UploadedFile>) | undefined;
  readonly problem: string | null;
  readonly clearProblem: () => void;
} {
  const { t } = useTranslations();
  const [problem, setProblem] = useState<string | null>(null);
  const clearProblem = useCallback(() => setProblem(null), []);

  const uploadFile = useMemo(() => {
    if (!store) {
      return undefined;
    }
    return async (file: File): Promise<UploadedFile> => {
      const form = new FormData();
      form.set("file", file);
      let result: TextFileResult;
      try {
        result = await store(form);
      } catch {
        // The request itself failed: too large for the request limit, or the
        // connection dropped. Nothing was kept that the text could name.
        result = { blobId: null, error: t("attachments.textUploadFailed") };
      }
      if (result.blobId === null) {
        const said = result.error ?? t("attachments.textUploadFailed");
        setProblem(said);
        throw new Error(said);
      }
      setProblem(null);
      return { blobId: result.blobId };
    };
  }, [store, t]);

  return { uploadFile, problem, clearProblem };
}
