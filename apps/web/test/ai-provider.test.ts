import { describe, expect, it, vi } from "vitest";

// Mocked for the import cost: `@openokr/core` carries the whole domain, and
// the function under test is a pure mapping.
vi.mock("@openokr/core", () => ({}));
vi.mock("../lib/pool", () => ({ getPool: vi.fn() }));
vi.mock("../lib/secrets", () => ({ getKeyRing: vi.fn() }));

const { providerConfigFor } = await import("../lib/ai-provider");

/**
 * Each configured provider becomes itself (completeness review H-27), and
 * the two that take an address carry the outbound guard when asked (H-07).
 *
 * Every model call used to be built as OpenRouter, whatever the workspace had
 * configured, so a workspace on Anthropic, OpenAI, Google, Ollama or an
 * OpenAI-compatible endpoint had no AI at all.
 */
const resolved = (
  provider:
    | "anthropic"
    | "openai"
    | "google"
    | "openrouter"
    | "ollama"
    | "openai-compatible",
  baseUrl: string | null = null,
) => ({ source: "workspace" as const, provider, apiKey: "key", baseUrl });

const options = {
  guardOutbound: true,
  appUrl: "https://okr.example.com",
  // The instance's own name rather than the software's (M-33).
  appName: "OKR Goal",
};

describe("providerConfigFor", () => {
  it.each(["anthropic", "openai", "google"] as const)(
    "builds %s as itself, with its own key",
    (provider) => {
      expect(providerConfigFor(resolved(provider), options)).toEqual({
        provider,
        apiKey: "key",
      });
    },
  );

  it("builds OpenRouter with the instance's own address and name", () => {
    expect(providerConfigFor(resolved("openrouter"), options)).toEqual({
      provider: "openrouter",
      apiKey: "key",
      appName: "OKR Goal",
      appUrl: "https://okr.example.com",
    });
  });

  it("builds Ollama at the configured address, guarded when asked", () => {
    expect(
      providerConfigFor(resolved("ollama", "http://ollama:11434/v1"), options),
    ).toEqual({
      provider: "ollama",
      baseUrl: "http://ollama:11434/v1",
      guardOutbound: true,
    });
  });

  it("leaves a self-hosted instance's local model unguarded", () => {
    expect(
      providerConfigFor(resolved("ollama", "http://ollama:11434/v1"), {
        ...options,
        guardOutbound: false,
      }),
    ).toMatchObject({ guardOutbound: false });
  });

  it("builds an OpenAI-compatible endpoint at its address", () => {
    expect(
      providerConfigFor(
        resolved("openai-compatible", "https://llm.example.com/v1"),
        options,
      ),
    ).toEqual({
      provider: "openai-compatible",
      apiKey: "key",
      baseURL: "https://llm.example.com/v1",
      guardOutbound: true,
    });
  });

  it("treats an OpenAI-compatible endpoint with no address as not configured", () => {
    expect(
      providerConfigFor(resolved("openai-compatible"), options),
    ).toBeNull();
  });
});
