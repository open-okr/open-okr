"use client";

import { RichTextEditor } from "@openokr/ui";
import { notFound } from "next/navigation";
import { useCallback, useState } from "react";
import { validateRichTextPreview } from "./actions.ts";

/**
 * The rich text editor preview (P2-T11, matching P2-T10's `/dev/components`
 * precedent — dev-only, no attack surface in production). Search and
 * upload are mocked here: `packages/ui` takes them as props rather than
 * reaching for a real member search or P2-T05's upload pipeline itself
 * (docs/design/rich-text-editor.md §6-7), and this page is the one place
 * outside a real screen that supplies working ones to actually exercise
 * the editor end to end.
 *
 * `validate` goes through `./actions.ts`'s Server Action, never a direct
 * `@openokr/core` import here: this file is a Client Component (it needs
 * `useState`), and `@openokr/core`'s barrel re-exports server-only
 * Postgres/Drizzle code alongside the pure rich-text validator — an
 * import straight from it broke the production build outright
 * (`Module not found: Can't resolve 'net'`), caught by actually running
 * `pnpm build` rather than only `tsc`, which has no opinion on what ends
 * up in a browser bundle.
 */

const MOCK_MEMBERS = [
  { id: "member-1", label: "Ada Lovelace" },
  { id: "member-2", label: "Grace Hopper" },
  { id: "member-3", label: "Alan Turing" },
];

const MOCK_ENTITIES = [
  { id: "abc123", label: "Q3 Growth objective" },
  { id: "def456", label: "Activation rate" },
];

async function mockSearch(source: typeof MOCK_MEMBERS, query: string) {
  return source.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase()),
  );
}

async function mockUpload(file: File) {
  await new Promise((resolve) => setTimeout(resolve, 800));
  return { blobId: `mock-${file.name}-${Date.now()}` };
}

// Module-scope, not inline arrows recreated every render: `RichTextEditor`
// only rebuilds its extension set (tearing down any in-progress suggestion
// popup along with it) when `searchMembers`/`searchEntities` change
// identity. `onUpdate` re-renders this page on every keystroke, so an
// inline arrow here would recreate the mention/entity-link plugins mid-query
// on every character typed — caught by actually typing into the running
// editor and watching the popup break, not by any static check.
function searchMembers(query: string) {
  return mockSearch(MOCK_MEMBERS, query);
}

function searchEntities(query: string) {
  return mockSearch(MOCK_ENTITIES, query);
}

export default function RichTextEditorPreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const [lastJson, setLastJson] = useState<unknown>(null);
  const [validity, setValidity] = useState<"unknown" | "valid" | "invalid">(
    "unknown",
  );

  const validate = useCallback(async (json: unknown) => {
    const valid = await validateRichTextPreview(json);
    setValidity(valid ? "valid" : "invalid");
    return valid;
  }, []);

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-2xl font-bold text-ink">Rich text editor</h1>
      <p className="text-sm text-ink-3">
        Type <code>@</code> for a member, <code>#</code> for an entity, or{" "}
        <code>/</code> at the start of a line for block commands. Paste or drop
        a file to try the attachment upload flow.
      </p>
      <div className="rounded-lg border border-line-2 bg-surface p-3">
        <RichTextEditor
          content={{ type: "doc", content: [{ type: "paragraph" }] }}
          searchMembers={searchMembers}
          searchEntities={searchEntities}
          uploadFile={mockUpload}
          validate={validate}
          onUpdate={setLastJson}
        />
      </div>
      <p className="text-xs text-ink-4">
        Last update validated as: <strong>{validity}</strong>
      </p>
      <pre className="max-h-64 overflow-auto rounded-lg bg-raised p-3 text-xs text-ink-2">
        {JSON.stringify(lastJson, null, 2)}
      </pre>
    </div>
  );
}
