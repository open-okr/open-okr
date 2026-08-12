/**
 * Type and size validation (TECHNICAL-PLAN §4.9, P2-T05).
 *
 * A fixed allow-list and a fixed size ceiling, not a workspace setting: the
 * §4.14 settings map is for choices a workspace actually makes, and nobody
 * has asked to raise a per-file ceiling yet. `storageQuotaBytes` (the total
 * across every file) is the setting; this is a constant until a real need
 * says otherwise.
 *
 * SVG is deliberately absent. It carries script content, and the sanitising
 * allow-list every rendering surface uses (§4) is for rich text, not for
 * files served back verbatim.
 */
export const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

/** 25 MiB. */
export const MAX_BLOB_BYTES = 25 * 1024 * 1024;

export interface ValidationResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export function validateUpload(input: {
  readonly contentType: string;
  readonly size: number;
}): ValidationResult {
  if (!ALLOWED_CONTENT_TYPES.has(input.contentType)) {
    return { ok: false, reason: `File type not allowed: ${input.contentType}` };
  }
  if (input.size <= 0) {
    return { ok: false, reason: "Empty file." };
  }
  if (input.size > MAX_BLOB_BYTES) {
    return {
      ok: false,
      reason: `File is larger than the ${MAX_BLOB_BYTES} byte limit.`,
    };
  }
  return { ok: true };
}
