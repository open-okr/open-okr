/**
 * Structured extraction with one repair attempt (AI-NATIVE-PLAN.md §1.8,
 * §3.4, P2-T15): "Model output passes Zod with one repair attempt, then
 * fails cleanly. The model is an untrusted source."
 *
 * Lives here, not in `packages/core`: it calls a real `AIProvider`, and
 * `packages/core` may not depend on `packages/adapters` (TECHNICAL-PLAN
 * §1). `packages/agents` is the one package meant to hold logic that spans
 * both — the Coach and Champion runtimes are its first callers, and any
 * future assist or copilot extraction is meant to share this rather than
 * re-write the repair loop per feature.
 */
import type {
  AIProvider,
  ChatMessage,
  ExtractRequest,
} from "@openokr/adapters";
import type { z } from "zod";

export interface ExtractStructuredInput<T> {
  readonly provider: AIProvider;
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly schema: z.ZodType<T>;
  /** JSON Schema for the provider's own `extract()` call — the same shape
   * `schema` describes, in the form a vendor API expects. Kept separate
   * rather than derived, since not every Zod version's JSON Schema output
   * is guaranteed to match what every driver wants verbatim. */
  readonly jsonSchema: Record<string, unknown>;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export class StructuredExtractionError extends Error {
  constructor(
    message: string,
    readonly firstAttempt: string,
    readonly repairAttempt: string | undefined,
  ) {
    super(message);
    this.name = "StructuredExtractionError";
  }
}

function tryParseJson(
  content: string,
): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(content) };
  } catch {
    return { ok: false };
  }
}

async function attempt<T>(
  provider: AIProvider,
  request: ExtractRequest,
  schema: z.ZodType<T>,
): Promise<{ readonly content: string; readonly result?: T }> {
  const response = await provider.extract(request);
  const parsed = tryParseJson(response.content);
  if (!parsed.ok) {
    return { content: response.content };
  }
  const validated = schema.safeParse(parsed.value);
  if (!validated.success) {
    return { content: response.content };
  }
  return { content: response.content, result: validated.data };
}

/**
 * Calls `provider.extract()`, validates the reply with `schema`. On
 * failure — malformed JSON or a shape Zod rejects — makes exactly one more
 * call, telling the model what was wrong, and validates that reply the
 * same way. A second failure throws rather than returning anything
 * unvalidated: the model is untrusted output, never a fallback source of
 * truth.
 */
export async function extractStructured<T>(
  input: ExtractStructuredInput<T>,
): Promise<T> {
  const baseRequest: ExtractRequest = {
    model: input.model,
    messages: input.messages,
    schema: input.jsonSchema,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
  };

  const first = await attempt(input.provider, baseRequest, input.schema);
  if (first.result !== undefined) {
    return first.result;
  }

  const repairRequest: ExtractRequest = {
    ...baseRequest,
    messages: [
      ...input.messages,
      { role: "assistant", content: first.content },
      {
        role: "user",
        content:
          "That reply was not valid JSON matching the required schema. " +
          "Return corrected JSON only, with no other text.",
      },
    ],
  };

  const repaired = await attempt(input.provider, repairRequest, input.schema);
  if (repaired.result !== undefined) {
    return repaired.result;
  }

  throw new StructuredExtractionError(
    "The model's output did not match the required schema, even after one repair attempt.",
    first.content,
    repaired.content,
  );
}
