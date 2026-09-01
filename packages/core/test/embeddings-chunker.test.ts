import { describe, expect, it } from "vitest";
import { chunkText, contentHash } from "../src/embeddings/chunker.ts";

describe("chunkText", () => {
  it("returns empty for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   ")).toEqual([]);
  });

  it("returns a single chunk for short text", () => {
    const result = chunkText("Hello world", { maxChunkSize: 100 });
    expect(result).toEqual([{ index: 0, content: "Hello world" }]);
  });

  it("splits at paragraph boundaries", () => {
    const text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
    const result = chunkText(text, { maxChunkSize: 30, overlap: 5 });
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]?.content).toBe("First paragraph.");
  });

  it("splits at sentence boundaries when no paragraph break fits", () => {
    const text = "First sentence. Second sentence. Third sentence. Fourth.";
    const result = chunkText(text, { maxChunkSize: 35, overlap: 5 });
    expect(result.length).toBeGreaterThanOrEqual(2);
    // First chunk should end at a sentence boundary
    expect(result[0]?.content).toMatch(/\.$/);
  });

  it("splits at word boundaries as fallback", () => {
    const text = "word ".repeat(20).trim();
    const result = chunkText(text, { maxChunkSize: 25, overlap: 5 });
    expect(result.length).toBeGreaterThanOrEqual(2);
    // No chunk should split a word
    for (const chunk of result) {
      expect(chunk.content).not.toMatch(/^\S+\s\S+$/);
    }
  });

  it("assigns ascending chunk indices", () => {
    const text = "A".repeat(500);
    const result = chunkText(text, { maxChunkSize: 100, overlap: 10 });
    for (let i = 0; i < result.length; i++) {
      expect(result[i]?.index).toBe(i);
    }
  });

  it("does not produce empty chunks", () => {
    const text = "Some text that is long enough to chunk properly here.";
    const result = chunkText(text, { maxChunkSize: 20, overlap: 5 });
    for (const chunk of result) {
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });
});

describe("contentHash", () => {
  it("returns the same hash for the same content", () => {
    const a = contentHash("hello world");
    const b = contentHash("hello world");
    expect(a).toBe(b);
  });

  it("returns different hashes for different content", () => {
    const a = contentHash("hello world");
    const b = contentHash("hello world!");
    expect(a).not.toBe(b);
  });

  it("returns an 8-character hex string", () => {
    const hash = contentHash("test");
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });
});
