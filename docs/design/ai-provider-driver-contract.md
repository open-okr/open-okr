# The AIProvider driver contract

P2-T13. This is the reference for adding a seventh driver. The port itself is `packages/adapters/src/ports/ai.ts`; every driver lives under `packages/adapters/src/drivers/ai/`; the one place anything outside this package reaches a provider is `createAIProvider` in `packages/adapters/src/create-ai-provider.ts`.

## What a driver must implement

The `AIProvider` interface, seven methods:

| Method | Contract |
|---|---|
| `chat(request)` | One completion. `content` and `usage` are required; `toolCalls` is present only when the model made one |
| `stream(request)` | An async generator yielding text chunks as they arrive. Never yields tool-call fragments — reassemble those into `chatWithTools` if a feature needs both at once |
| `chatWithTools(request)` | Same as `chat`, plus `tools`. `toolCalls` is present whenever the model called one |
| `embed(request)` | Vectors for the given input strings. Throw `AIUnavailableError` if the provider has no embedding endpoint at all — never fabricate a vector |
| `extract(request)` | A completion whose `content` is a JSON string matching `request.schema`. The **caller** re-validates with Zod; a driver's job is to get the provider to emit that shape, by whatever mechanism the provider actually offers (a JSON-schema response format, a forced tool call, or a plain instruction to the model — pick whichever is real for that provider, never fake conformance) |
| `capabilities(model)` | A model's capability flags. With no live model catalogue yet (P2-T15), every driver returns one reasonable default for every model it's asked about; a driver is free to hard-code this rather than guess emptily |
| `stop()` | Releases anything the driver holds open. Every current driver's underlying client makes one HTTP call per request and holds nothing between them, so every `stop()` today is a documented no-op — but it must exist, and a driver whose client *does* hold something open (a persistent connection, a background poller) must actually release it here. `Adapters.close()` calls this on every port; a driver that leaks past its own `stop()` leaks past that too |

## The three roles every message needs translating for

The port's own `ChatMessage.role` is `system | user | assistant | tool`. No vendor speaks that exact shape:

- **OpenAI-shaped** (`openai.ts`, `openrouter.ts`, `ollama.ts`, `openai-compatible.ts`, all one implementation in `openai-compatible.ts`): all four roles map directly, except `tool` needs `tool_call_id` set from `ChatMessage.toolCallId`.
- **Anthropic**: no `system`-role message at all. Fold every `system`-role message into the top-level `system` string parameter before building the `messages` array; a `tool`-role message becomes a `user`-role message with a `tool_result` content block.
- **Google**: roles are `user`/`model`, not `user`/`assistant`. System text is `config.systemInstruction`, a separate parameter exactly like Anthropic's.

Get this wrong and a multi-turn tool conversation still looks like it works in the simple case — the failure only shows up once a real system prompt or a real tool round-trip is involved. Every driver's own test file proves this translation explicitly; it is not something to assume once and never check again.

## `embed()` when a provider has none

Anthropic has no embeddings endpoint. Its `embed()` throws `AIUnavailableError` — the same error a feature sees when it calls a method the provider genuinely lacks, per the port's own doc comment: "Features are expected to check `capabilities()` and never see this." Never approximate an embedding by hashing text or calling a different provider silently from inside a driver; the tier map is where an embedding call gets routed to a provider that actually has one, not inside the driver that doesn't.

## Structured output when a provider has no JSON-schema mode

Not every provider's `extract()` uses the same mechanism:

- **OpenAI-shaped**: `response_format: { type: "json_schema", json_schema: { name, schema, strict } }`.
- **Anthropic**: no such option exists. Force exactly one tool call whose `input_schema` is the caller's schema (`tool_choice: { type: "tool", name: "extract" }`); a forced tool call's only legal output is that tool's arguments, which is the structured result.
- **Google**: `responseMimeType: "application/json"` plus `responseJsonSchema` — deliberately not `responseSchema`, which is Google's own OpenAPI-3.0-subset `Schema` type (its own `Type` enum, no `additionalProperties`) rather than plain JSON Schema. Translating this port's schemas into that type would be a second schema language for every caller to think about; `responseJsonSchema` accepts the plain shape directly, at the cost of a smaller documented feature subset.

## The tier map every driver seeds

AI-NATIVE-PLAN §3.4: "Every driver ships a seeded default tier map... A driver added without a default tier map is incomplete." Each real driver's own file exports a `..._DEFAULT_TIER_MODELS: TierModelMap` naming a model for `fast`, `balanced`, `deep`, and `embed` where the provider has one. `off` and the fully generic `openai-compatible` driver seed nothing — there is no model to name for a provider with no capability, or one whose models only its own operator knows. `defaultTierModelsFor(provider)` in `create-ai-provider.ts` is the one place that reads these; P2-T15's routing layer resolves a feature's requested tier through a workspace's policy to an actual model, using this as the seed a fresh workspace starts from before anyone has configured anything.

These are seeds, not a catalogue — free-text, easily wrong the day a vendor renames a model, and meant to be overridden the moment P2-T15's admin screen exists. Update them when they visibly rot; do not treat them as load-bearing.

## Contract tests

Every real driver has its own test file (`packages/adapters/test/ai-<driver>.test.ts`) proving it parses that vendor's actual documented response shape correctly — a fixture, not a live call, since this repository never holds a real key. Two injection seams, because the vendors' SDKs don't agree on offering one:

- **OpenAI-shaped and Anthropic**: both SDK constructors accept a `fetch` option. Inject a fake `typeof fetch` returning a hand-built `Response` (JSON for a plain call, `text/event-stream`-formatted text for a streamed one) and the driver runs exactly the parsing code a real call would.
- **Google**: the SDK has no `fetch` option at all — only `httpOptions.baseUrl`, which redirects the whole client rather than one call. `GoogleProviderOptions.client` exists for exactly this: a pre-built object matching the minimal `GoogleGenAIClient` interface (just the three methods this driver calls), constructed directly in the test with `vi.fn()`.

A driver's test file is the place a fixture drifting from what the vendor actually returns gets caught — keep it current when a vendor's response shape changes, the same way the driver code itself needs updating then too.

## Adding a seventh driver

1. A new file under `drivers/ai/`, implementing `AIProvider` directly, or a thin preset over `OpenAiCompatibleProvider` if the new vendor speaks the same chat-completions shape (most gateways and self-hosted servers do).
2. A `..._DEFAULT_TIER_MODELS` export.
3. One branch each in `createAIProvider` and `defaultTierModelsFor` (`create-ai-provider.ts`).
4. A contract test file proving the response-shape parsing, against a fixture matching the vendor's own documented format.
5. Nothing else. No feature code names a driver; every feature reaches a provider only through the port, resolved by whichever configuration (P2-T14) picked this one.
