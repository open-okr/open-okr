/**
 * Decode-safe extraction (docs/design/rich-text-editor.md §5, §7;
 * TECHNICAL-PLAN §4.10: "mention extraction is decode-safe: malformed
 * content yields an empty list, never an error"). Deliberately looser
 * than `parseRichText`: a caller here wants "whatever can be found," not
 * a hard failure over one bad node deep in an otherwise fine document —
 * fanning out notifications or reconciling attachments should not go
 * silent just because one unrelated part of a huge document is off-spec.
 */

function walk(
  node: unknown,
  visit: (record: Record<string, unknown>) => void,
): void {
  if (typeof node !== "object" || node === null) {
    return;
  }
  const record = node as Record<string, unknown>;
  visit(record);
  if (Array.isArray(record.content)) {
    for (const child of record.content) {
      walk(child, visit);
    }
  }
}

export function extractMentionIds(input: unknown): readonly string[] {
  const ids: string[] = [];
  try {
    walk(input, (node) => {
      if (
        node.type === "mention" &&
        typeof node.attrs === "object" &&
        node.attrs !== null
      ) {
        const id = (node.attrs as Record<string, unknown>).id;
        if (typeof id === "string" && id.length > 0) {
          ids.push(id);
        }
      }
    });
  } catch {
    return [];
  }
  return ids;
}

export interface ExtractedAttachment {
  readonly blobId: string | undefined;
  readonly status: "uploading" | "ready";
}

export function extractAttachments(
  input: unknown,
): readonly ExtractedAttachment[] {
  const attachments: ExtractedAttachment[] = [];
  try {
    walk(input, (node) => {
      if (
        node.type !== "attachment" ||
        typeof node.attrs !== "object" ||
        node.attrs === null
      ) {
        return;
      }
      const attrs = node.attrs as Record<string, unknown>;
      const status = attrs.status === "ready" ? "ready" : "uploading";
      const blobId =
        typeof attrs.blobId === "string" ? attrs.blobId : undefined;
      attachments.push({ blobId, status });
    });
  } catch {
    return [];
  }
  return attachments;
}
