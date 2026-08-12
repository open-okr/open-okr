/**
 * The AIProvider port (AI-NATIVE-PLAN §3.1).
 *
 * Vendor SDKs live only behind this interface. Every feature that uses it
 * must still work when the provider is off: AI adds drafting, rewriting and
 * semantic judgement, never a decision. `capabilities()` is how a feature
 * discovers what it may offer and degrades instead of failing.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
  /** Set on `tool` messages: which call this answers. */
  readonly toolCallId?: string;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the arguments. */
  readonly parameters: Record<string, unknown>;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface ChatRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ChatResponse {
  readonly content: string;
  readonly usage: TokenUsage;
  readonly toolCalls?: readonly ToolCall[];
}

export interface EmbedRequest {
  readonly model: string;
  readonly input: readonly string[];
}

export interface EmbedResponse {
  readonly vectors: readonly (readonly number[])[];
  readonly dimensions: number;
  readonly usage: TokenUsage;
}

export interface ExtractRequest extends ChatRequest {
  /** JSON Schema the reply must satisfy. The caller re-validates with Zod. */
  readonly schema: Record<string, unknown>;
}

export interface ModelCapabilities {
  readonly available: boolean;
  readonly tools: boolean;
  readonly vision: boolean;
  readonly jsonMode: boolean;
  readonly streaming: boolean;
  readonly contextWindow: number;
  readonly embeddingDimensions?: number;
}

export interface AIProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  stream(request: ChatRequest): AsyncIterable<string>;
  chatWithTools(
    request: ChatRequest & { readonly tools: readonly ToolDefinition[] },
  ): Promise<ChatResponse>;
  embed(request: EmbedRequest): Promise<EmbedResponse>;
  extract(request: ExtractRequest): Promise<ChatResponse>;
  capabilities(model: string): ModelCapabilities;
  /** Releases whatever this driver holds open. The off driver owns nothing; a
   * real vendor driver's long-lived HTTP client is not exempt from closing. */
  stop(): Promise<void>;
}

/** Thrown when a feature calls a provider that is off or lacks a capability.
 * Features are expected to check `capabilities()` and never see this. */
export class AIUnavailableError extends Error {
  override readonly name = "AIUnavailableError";
  constructor(message = "No AI provider is configured.") {
    super(message);
  }
}
