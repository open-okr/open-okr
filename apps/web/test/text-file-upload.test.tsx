// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TranslationsProvider, type UploadedFile } from "@openokr/ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { TextFileResult } from "../lib/attachment-actions.ts";
import {
  type StoreTextFile,
  useTextFileUpload,
} from "../lib/text-file-upload.ts";

/**
 * A file pasted or dropped into a comment or a document (plan 0.7.0 R4).
 *
 * The editor removes a node whose upload fails, so the hook has to keep the
 * reason for the field to show, and reject so the editor knows to take the
 * node out. The node turns `ready` only with the id of a file the server
 * stored and claimed, which is what the write boundary asks (R1).
 */

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const BLOB = "11111111-1111-4111-8111-111111111111";

interface Seen {
  uploadFile: ((file: File) => Promise<UploadedFile>) | undefined;
  problem: string | null;
}

/** Records what the hook returned on its latest render. */
function Probe({
  store,
  seen,
}: {
  readonly store: StoreTextFile | undefined;
  readonly seen: Seen;
}) {
  const hook = useTextFileUpload(store);
  seen.uploadFile = hook.uploadFile;
  seen.problem = hook.problem;
  return null;
}

/** Mounts the hook and hands back what it returned on its latest render. */
async function mount(store: StoreTextFile | undefined): Promise<Seen> {
  const seen: Seen = { uploadFile: undefined, problem: null };
  await act(async () => {
    root.render(
      <TranslationsProvider locale="en">
        <Probe store={store} seen={seen} />
      </TranslationsProvider>,
    );
  });
  return seen;
}

const file = () =>
  new File(["picture"], "whiteboard.png", { type: "image/png" });

describe("storing a file for the text", () => {
  test("hands the editor the id of the stored file, sending the file itself", async () => {
    const sent: FormData[] = [];
    const seen = await mount(async (form) => {
      sent.push(form);
      return { blobId: BLOB, error: null };
    });

    let uploaded: UploadedFile | undefined;
    await act(async () => {
      uploaded = await seen.uploadFile?.(file());
    });

    expect(uploaded).toEqual({ blobId: BLOB });
    expect((sent[0]?.get("file") as File | null)?.name).toBe("whiteboard.png");
    expect(seen.problem).toBeNull();
  });

  test("rejects with the server's sentence, and keeps it for the field", async () => {
    const refusal: TextFileResult = {
      blobId: null,
      error: "This file type is not allowed.",
    };
    const seen = await mount(async () => refusal);

    await act(async () => {
      await expect(seen.uploadFile?.(file())).rejects.toThrow(
        "This file type is not allowed.",
      );
    });
    expect(seen.problem).toBe("This file type is not allowed.");
  });

  test("says the upload failed when the request itself does", async () => {
    const seen = await mount(async () => {
      throw new Error("Body exceeded 8mb limit");
    });

    await act(async () => {
      await expect(seen.uploadFile?.(file())).rejects.toThrow();
    });
    expect(seen.problem).toBe(
      "That file could not be uploaded. Try again, or attach a smaller one.",
    );
  });

  test("offers the editor nothing where the host stores no file", async () => {
    const seen = await mount(undefined);
    expect(seen.uploadFile).toBeUndefined();
  });
});

describe("where a person can put a file in the text", () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

  // Both surfaces R4 names store through the files panel's own upload, so
  // no second way to keep a file exists to drift from it.
  test("the comment composer and the document editor are given the upload", () => {
    expect(read("../lib/subject-comments.tsx")).toContain(
      "storeFile={uploadTextFile}",
    );
    expect(read("../app/documents/[id]/page.tsx")).toContain(
      "storeFile={uploadTextFile}",
    );
    expect(read("../lib/attachment-actions.ts")).toMatch(
      /export async function uploadTextFile[\s\S]*storeUpload\(/,
    );
  });
});
