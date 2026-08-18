/**
 * Content chunking for the embedding pipeline (AI-NATIVE-PLAN.md §9, P4-T13).
 *
 * Splits text into chunks small enough for the embedding model's context
 * window. Each chunk overlaps the previous one by a fixed number of characters
 * so a retrieval hit near a boundary still carries its surrounding context.
 *
 * Pure. No database, no AI provider.
 */

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_OVERLAP = 200;

export interface ChunkOptions {
  readonly maxChunkSize?: number;
  readonly overlap?: number;
}

export interface Chunk {
  readonly index: number;
  readonly content: string;
}

/**
 * Split text into overlapping chunks.
 *
 * Prefers splitting at paragraph boundaries (double newline), then at
 * sentence boundaries (period followed by whitespace), then at word
 * boundaries. Falls back to a hard cut only when a single word exceeds
 * the chunk size.
 */
export function chunkText(text: string, options?: ChunkOptions): Chunk[] {
  const maxSize = options?.maxChunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options?.overlap ?? DEFAULT_OVERLAP;

  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }
  if (trimmed.length <= maxSize) {
    return [{ index: 0, content: trimmed }];
  }

  const chunks: Chunk[] = [];
  let start = 0;

  while (start < trimmed.length) {
    let end = Math.min(start + maxSize, trimmed.length);

    if (end < trimmed.length) {
      // Try paragraph boundary
      const paragraphBreak = trimmed.lastIndexOf("\n\n", end);
      if (paragraphBreak > start) {
        end = paragraphBreak;
      } else {
        // Try sentence boundary
        const sentenceBreak = trimmed.lastIndexOf(". ", end);
        if (sentenceBreak > start) {
          end = sentenceBreak + 1;
        } else {
          // Try word boundary
          const wordBreak = trimmed.lastIndexOf(" ", end);
          if (wordBreak > start) {
            end = wordBreak;
          }
          // else: hard cut at maxSize
        }
      }
    }

    chunks.push({
      index: chunks.length,
      content: trimmed.slice(start, end).trim(),
    });

    // Advance past the chunk, minus the overlap. The next start has to be
    // strictly greater than this one, and the guard has to say so directly.
    //
    // The previous guard compared against `end - maxSize`, which reduces to
    // "only when overlap is at least maxSize" and misses the case that
    // actually happens: a paragraph or sentence boundary found close to
    // `start` pulls `end` back, `end - overlap` lands at or behind `start`,
    // and the loop stops advancing while the array keeps growing until the
    // process dies. That is what was killing this suite's worker.
    const next = end - overlap;
    start = next > start ? next : end;
  }

  return chunks;
}

/**
 * Compute a content hash for change detection. Uses a simple string hash
 * that is fast and deterministic. Not cryptographic, just for deduplication.
 */
export function contentHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  // Convert to a positive hex string
  return (hash >>> 0).toString(16).padStart(8, "0");
}
