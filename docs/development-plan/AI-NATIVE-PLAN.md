# AI-NATIVE-PLAN.md

The plan for OpenOKR's **AI layer**. It specifies how AI is built into the product from day one, across every module, as an accelerator that never becomes a dependency: how the provider abstraction works (bring-your-own key, OpenRouter, or a local model like Ollama), how the admin manages it, how OpenOKR ships an **MCP server** so any AI agent can drive OKRs and projects on the user's behalf, and how an in-app copilot takes actions safely inside the user's own permissions.

Authority: peer of TECHNICAL-PLAN.md for the AI domain; both defer to PLAN.md and REQUIREMENTS.md (full order in CLAUDE.md). The §12 task list is execution authority for **Phase 5**, under IMPLEMENTATION-PLAN.md's Definition of Ready and task-loop rules.

Why this document exists: the rest of the plan set treats AI as one optional adapter port (`chat/embed/extract`, off by default, "summaries and drafting"). The product goal is the opposite. AI is a first-class surface of OpenOKR, present in project creation, OKR authoring, KPI analysis, check-ins, meetings, search, and administration, and reachable by external agents over MCP. This document raises AI from a stub to a domain, without breaking the air-gap and "no LLM on a required path" guarantees that make OpenOKR safe for on-prem institutions.

Provenance note: OpenOKR's OKR authoring assists are informed by a working implementation in the FlowyTeam/OKRI Learn product (Laravel, OpenRouter-backed). §11 records what that design got right, what it got wrong, and how OpenOKR improves on each point. We reuse the ideas and the data (behavior), never the code (CLAUDE.md clean-room rule).

---

## 1. The AI-native stance (principles, ranked)

These sit above the feature list. When a design choice is unclear, the higher principle wins.

1. **Native, not dependent.** Every AI feature is an accelerator layered over a complete manual path. Remove AI and the product still works end to end. This is what lets OpenOKR be AI-native *and* air-gap-safe at the same time.
2. **The agent is the user, never a superuser.** Every AI action, in-app or over MCP, runs through the same `can(user, permission, context)` check and the same Row Level Security as a human click. An agent can do exactly what the acting user can do, and nothing more. Authorization is the backstop that makes prompt injection non-catastrophic.
3. **Bring your own brain.** The deployment, the workspace admin, or the individual user chooses the provider and supplies the key: a hosted model (Anthropic, OpenAI, Google, OpenRouter) or a local one (Ollama, vLLM, LM Studio, any OpenAI-compatible endpoint). No provider is hardcoded. Air-gapped installs point at a local model or turn AI off.
4. **Writes are proposed, then confirmed.** AI drafts; the human commits. In-app, a write shows as a preview or diff with an approve action and an undo toast. Over MCP, writes require a read-write token scope, and the human still owns the token.
5. **Nothing leaves the instance silently.** The admin controls exactly what context may be sent to a non-local provider, PII is redacted from prompts, egress is allow-listed, and every AI call is metered and auditable. A local provider means zero egress.
6. **Cost is visible and capped.** Every call records tokens and cost. Quotas and hard caps protect budgets, especially a user's own BYO-key budget. No feature can run the bill up invisibly.
7. **Structured output is validated, never trusted.** Model JSON passes through Zod at the boundary like any other external input, with a retry on failure. The model is an untrusted source.
8. **One tool registry, three consumers.** The in-app copilot, the MCP server, and the documented REST surface all call the *same* permission-checked tools in `packages/core`. We define an action once and expose it three ways.

### 1.1 Resolving the tension with the existing hard rules

PLAN.md and CLAUDE.md carry three guarantees that AI-native must not break. It does not, and here is exactly how:

| Existing guarantee | How AI-native keeps it |
|---|---|
| "No LLM call may sit on a required path." | Preserved verbatim as principle 1. A CI test (§10) boots the app with `AI_PROVIDER=off` and asserts every P0 flow still passes. AI features hide or disable; underlying actions stay manual. |
| "Air-gapped installs can point the AIProvider at a local model or disable it." | Strengthened. Ollama and any OpenAI-compatible base URL are first-class providers (§3.2), embeddings run locally (§9), and the MCP server itself makes no outbound AI calls. Being AI-native does not mean being cloud-dependent. |
| "Postgres is the only required service." | Kept. Semantic search uses the **pgvector** extension of Postgres, not a separate vector service. Where pgvector is unavailable, retrieval degrades to Postgres full-text search (§9). No new service is required. |

The one principle that changes: AI shifts from **off by default** to **on by default wherever a provider is configured**, per feature, admin-controllable. A deployment with no key configured behaves exactly like today's plan (AI off, everything manual). This is the whole difference between "bolted on" and "built in".

---

## 2. What "AI-native everywhere" means: the capability catalog

AI shows up in every module as named, scoped capabilities. Each is an accelerator over an existing manual action (principle 1), uses one of the port capabilities from §3.1, and is independently toggleable by the admin (§4). "Write" capabilities always propose-then-confirm (principle 4).

### 2.1 Strategy (OKR / KPI / check-ins) — built in Phase 4

| Capability | Kind | Port cap | Degrades to |
|---|---|---|---|
| Draft an objective + key results from a goal / role / industry | write | tools/extract | the blank create form |
| Rate objective clarity (score + feedback) | read | extract | no score shown |
| Improve an objective or a key result (rewrite + reason) | write | extract | manual edit |
| Suggest the next key result (complementary, non-duplicate) | write | extract | manual add |
| Suggest a metric type, unit, and target for a key result | write | extract | manual entry |
| Suggest the cycle / period for a goal | write | extract | manual pick |
| Suggest an alignment parent (which objective/KR this rolls up to) | write | tools | manual picker |
| Draft this period's check-in from recent activity and KR movement | write | tools | blank check-in |
| Summarize check-in blockers and risks across a team | read | chat | read the list |
| Coach: "is this a good OKR?" against the methodology | read | chat | the guide docs |
| Suggest KPIs for an objective; suggest target and RAG thresholds | write | extract | manual KPI create |
| Draft a calculated-KPI formula from a plain-language description | write | extract | the formula builder |
| Narrate a KPI trend or flag an anomaly in its history | read | chat | read the chart |

### 2.2 Work management (projects, work packages, meetings, wiki) — built in Phase 3

| Capability | Kind | Port cap | Degrades to |
|---|---|---|---|
| Summarize a work-package comment thread on demand | read | chat | read the thread (this is the one capability the base plan already names) |
| Draft a work package from one sentence | write | extract | blank WP form |
| Decompose an objective or an epic into work packages | write | tools | manual breakdown |
| Suggest assignee, estimate, or acceptance criteria | write | extract | manual entry |
| Detect likely duplicate work packages | read | embed | manual search |
| Summarize a project's status into a report paragraph | read | chat | the overview widgets |
| Draft release notes from the work closed in a version | write | chat | manual notes |
| Draft a meeting agenda from linked work packages and OKRs | write | tools | blank agenda |
| Summarize meeting notes into outcomes + action items (create WPs) | write | tools | manual minutes |
| Draft, expand, or summarize a wiki page | write | chat | the editor |
| Ask a question across the wiki / a project (grounded answer) | read | embed+chat | full-text search |

### 2.3 Cross-cutting

| Capability | Kind | Port cap | Notes |
|---|---|---|---|
| **Workspace copilot** (chat that answers and *acts*) | read+write | tools | §6; grounded via §9; every action permission-checked |
| **Natural-language to query DSL** ("at-risk objectives in Marketing this quarter") | read | extract | emits a validated §4.5 query, never raw SQL |
| Global semantic search across OKRs, work packages, wiki | read | embed | §9; permission-filtered; hybrid with FTS |
| Portfolio / alignment-gap narrative for a PMO | read | chat | grounded, read-only |
| Importer: suggest a mapping for an unmappable legacy filter, formula, or custom field | write | extract | human approves; strictly off the import required path |

### 2.4 The MCP surface (external agents) — §5

Everything in §2.1–§2.3 that is an *action* (create/update/check-in/record/link/comment/query) is also exposed as an MCP tool, so a user's chosen agent (Claude Desktop, Claude Code, Cursor, a custom agent) can do the same work from outside OpenOKR, as that user, within that user's permissions.

---

## 3. AI architecture

### 3.1 The AIProvider port (elevated)

The base plan's port has three methods. The AI-native port keeps the shape (one interface in `packages/adapters`, vendor SDKs live only there) and widens the surface:

| Method | Purpose |
|---|---|
| `chat(messages, opts)` | completion; `opts`: `model`/`tier`, `temperature`, `maxTokens`, `stop`, `responseFormat` |
| `stream(messages, opts)` | token streaming (Server-Sent Events) for the copilot and long drafts |
| `chatWithTools(messages, tools, opts)` | native tool/function calling; drives the agent loop in §6 |
| `embed(texts, opts)` | vectors for retrieval (§9) |
| `extract(schema, input, opts)` | structured output; the driver requests JSON mode where the model supports it, and the result is Zod-validated by the caller (§10) |
| `rerank(query, docs)` *(optional)* | retrieval reranking; falls back to vector score if the provider lacks it |
| `capabilities(model)` | introspection: `{ tools, vision, jsonMode, contextWindow, embeddingDims, streaming }` so features can adapt or degrade |

Key architectural difference from the other ports: the other adapters are selected by the `RUNTIME` env var at boot. **The AI driver is selected by stored configuration, per request, resolved from the workspace and user (§3.3)**, layered over whichever runtime is active. A request-scoped factory reads the effective config, decrypts the key server-side, and returns a driver instance. Feature code calls `ai.chat(...)`; it never knows which provider answered.

### 3.2 Provider drivers (all inside `packages/adapters`)

| Provider | Models | Tools | Embeddings | Notes |
|---|---|---|---|---|
| `anthropic` | Claude family | yes | via a companion embed model | prompt caching; `anthropic-beta` no-train posture |
| `openai` | GPT family | yes | yes | JSON mode; org/project ids |
| `google` | Gemini family | yes | yes | |
| `openrouter` | many, one key | model-dependent | some | meta-provider; the FlowyTeam product uses this. Attribution headers (`HTTP-Referer`, `X-Title`) |
| `ollama` | local (Llama, Qwen, etc.) | model-dependent | yes (`nomic-embed-text`) | **base URL** setting (default `http://localhost:11434`); the air-gap default |
| `openai-compatible` | any | model-dependent | model-dependent | generic base-URL + key driver: vLLM, LM Studio, LiteLLM, Groq, Together, self-hosted gateways |
| `off` | none | no | no | no-op driver; every capability reports unavailable and features degrade |

Adding a driver is adding one file that satisfies the port interface plus a row in the model catalog (§3.4). No feature code changes.

### 3.3 Bring-your-own-key and the config precedence

Three layers, highest wins. Any layer may be absent.

| Layer | Set by | Stored in | Use |
|---|---|---|---|
| **Deployment default** | env vars (`AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`) | env, Zod-validated at boot | zero-config: a self-hoster sets one key and every workspace can use AI |
| **Workspace** | workspace admin, in the UI (§4) | `ai_providers` + `ai_credentials` (encrypted) | the normal case: one org, one billing key, admin-controlled features |
| **User (BYO)** | the individual, if the workspace allows it | `ai_credentials` scoped to the user | the user's own key bills to them; used especially for their MCP/agent traffic so heavy personal use does not spend the org key |

Resolution per call: **user key (if present and feature-allowed) → workspace config → deployment default → `off`**. The resolver returns the provider, base URL, model policy (§3.4), and the decrypted key. If it resolves to `off`, the feature degrades.

**Key storage.** Keys are encrypted at rest with envelope encryption (a data key per secret, wrapped by a master key from env or an external KMS where configured), never returned to the client, never logged, and decrypted only server-side at call time. Each stored key keeps a display hint (`sk-...abcd`) and a status. A "Test connection" action does a cheap live call and reports reachability without exposing the key. (This improves on the FlowyTeam product's single `Crypt::encryptString` global key: see §11.)

### 3.4 Model catalog and routing

Features do not name a model. They request a **capability tier**, and a workspace policy maps the tier to a concrete model. This lets the admin run cheap models for cheap tasks and strong models for reasoning, and lets air-gapped installs map every tier to a local model.

| Tier | Typical use | Example (hosted) | Example (local) |
|---|---|---|---|
| `fast` | title cleanup, classification, short rewrites | a small/cheap chat model | a 3–8B local model |
| `balanced` | most authoring assists, summaries | a mid chat model | an 8–14B local model |
| `deep` | OKR critique, decomposition, agent reasoning | a frontier chat model | the largest local model available |
| `embed` | retrieval vectors | a hosted embedding model | `nomic-embed-text` on Ollama |

- `ai_models` is a **catalog**: `provider`, `model_id`, `display_name`, `context_window`, `capabilities`, `cost_in`/`cost_out` per million tokens, tier tags, `active`. Seeded, and refreshable from the provider's live model list where one exists (OpenRouter, OpenAI, Ollama `/api/tags`).
- `ai_model_policies` maps `(workspace, tier) → (provider, model_id, temperature, max_tokens, json_mode)`.
- For OpenRouter and OpenAI-compatible providers the admin may still type any model id (parity with the FlowyTeam product's free-text field), but the id is **validated against the live model list when reachable** and a context-window guard prevents oversize requests. This fixes the FlowyTeam product's unvalidated free-text model box (§11).

---

## 4. Admin management surface (S-24)

A dedicated **Admin → AI** area, permission-gated by `manage_ai` (added to the RBAC catalogue, TECHNICAL-PLAN §4.1 / P2-T01). It follows the S-13 two-level settings pattern and is workspace-scoped. Cards:

1. **Provider & connection.** Provider dropdown (`anthropic`/`openai`/`google`/`openrouter`/`ollama`/`openai-compatible`/`off`), base URL (shown for local/compatible), API key (encrypted, masked, **Test connection**), org/project id where relevant, and whether users may bring their own key.
2. **Models & routing.** The tier → model map (§3.4), validated against the live model list where reachable; per-tier temperature, top-p, max tokens, and JSON-mode; the context-window guard.
3. **Features.** A switch per capability from §2 (generator, coach, WP summary, meeting summary, copilot, NL-query, and so on), each independently on/off, defaulting on when a provider is configured. This generalizes the FlowyTeam product's two kill switches into per-feature control.
4. **Budgets & limits.** Quotas by **tokens, cost, or calls** (admin picks), per user / per workspace / per period; a hard **cost cap** that auto-disables AI when exceeded; a short-window throttle interval. Fixes the FlowyTeam product's call-count-only quota and its never-populated cost field (§11).
5. **Prompts.** The system prompt per feature, **versioned and editable**, with a shipped default and a one-click restore-to-default; documented template variables; edits are workspace-scoped and take effect on save. A/B or staged prompt changes are gated by the eval harness (§10).
6. **Privacy & governance.** What context may be sent to a non-local provider (off / titles-only / full), PII redaction toggle, the no-train provider header assertion, the egress domain allow-list, and a per-workspace AI opt-out. Local provider ⇒ these are moot (zero egress) and the UI says so.
7. **MCP & agents.** Enable the MCP server, mint / rotate / revoke scoped agent tokens with per-token scope and rate limit, and see connected agents with last-used and audit links (§5).
8. **Usage & logs.** Token and cost dashboards (by user, feature, model, period), a request log with truncated payloads and a "flag misuse" toggle, and the latest eval results.

### 4.1 What this improves over the source product (summary; detail in §11)

Provider abstraction and local models (was OpenRouter-only), BYO user keys (was one global key), validated model catalog with tiers (was one unvalidated free-text model), real per-token cost metering and caps (cost was a stubbed column), per-feature toggles (was two switches), versioned prompts, privacy/egress controls, and the whole MCP + copilot surface (did not exist).

---

## 5. The MCP server (OpenOKR as an agent-drivable tool)

OpenOKR ships a **Model Context Protocol server** so any MCP-capable AI agent can read and manage a user's OKRs, KPIs, and projects from outside the app. This is requirement-level: "each user/admin can manage their project/OKR via MCP with their preferred AI agent."

### 5.1 Shape

| Aspect | Decision |
|---|---|
| Role | OpenOKR is the **server**; the user's agent (Claude Desktop, Claude Code, Cursor, a custom client) is the **client** |
| Transports | **stdio** (local, for desktop agents) and **Streamable HTTP** (remote, for hosted agents); both over the same tool registry |
| Auth | scoped **Personal Access Tokens** from TECHNICAL-PLAN §8.2 (`api_tokens`, extended with an `mcp` capability and `read`/`write`/`admin` scopes); OAuth 2.1 authorization-code flow where the client supports it |
| Identity | the token resolves to **one user in one workspace**; the server sets the `app.workspace_id` GUC and runs every call as that user |
| Enforcement | every tool call passes `can(user, permission, ctx)` + RLS (principle 2); write tools require a `write` scope, admin tools require `admin` scope *and* the underlying permission |
| Rate + audit | per-token rate limit via the Cache port; every tool call writes an `audit_events` row and an `ai_tool_calls` row |
| Egress | the OpenOKR MCP server makes **no outbound AI calls** of its own; the model lives in the user's agent. Air-gap-safe by construction |

### 5.2 What the server exposes

- **Tools** — the action registry from §6.2, e.g. `create_objective`, `update_key_result`, `check_in`, `record_kpi`, `create_work_package`, `link_work_to_okr`, `add_comment`, `run_query`, `search`. Names and field lists follow the canonical shapes documented for the source product (`reference/flowyteam-okr-kpi-tasks-model.md` §8) so existing agent integrations map cleanly.
- **Resources** — read-only handles an agent can fetch: an objective, a project, a saved query's result set, a cycle's scorecard. Backed by the same permission-scoped reads as the UI.
- **Prompts** — MCP prompt templates the agent can offer the user: "Run my weekly check-in", "Draft next quarter's OKRs for team X", "Summarize project status".

### 5.3 Relationship to P4-T19

The existing task P4-T19 ("OKR/KPI/Tasks REST + MCP-compatible API") defines the REST resources and the *field shapes*. Phase 5's P5-T09 builds the **actual MCP server** (transports, auth, tool/resource/prompt registration, per-user enforcement) on top of those shapes and the §6 tool registry. P4-T19 stays as written; P5-T09 depends on it.

### 5.4 Outbound MCP (optional, later)

The reverse direction (OpenOKR's own copilot calling *external* MCP tools, e.g. a GitHub or Slack MCP server) is a natural extension of the §6 tool loop: external MCP tools register into the same registry behind an admin allow-list. Designed for, not built in v1. Listed in §13.

---

## 6. The agentic layer (in-app copilot + the shared tool registry)

### 6.1 The copilot

A workspace **copilot** panel (a SidePanel, S-25) that answers questions and takes actions. It:

- grounds answers in the workspace's own data via retrieval (§9), permission-filtered so it can only cite what the user may see;
- takes actions through the tool registry (§6.2), each one permission-checked;
- **proposes writes as a preview or diff** and waits for the user to approve (principle 4), then applies through the normal mutation layer so optimistic UI, undo, and audit all work;
- streams its response and can be stopped mid-generation;
- degrades cleanly: with AI `off`, the panel shows "AI is disabled for this workspace" and every action it would offer is still reachable by hand.

### 6.2 The tool registry (one definition, three consumers)

A single registry in `packages/core`. Each tool is:

```ts
// One tool = one permission-checked action. The registry is the single
// source of truth for the copilot (§6.1), the MCP server (§5), and REST docs.
type AiTool = {
  name: string;                 // e.g. "create_objective"
  description: string;          // shown to the model
  inputSchema: ZodType;         // validated before the handler runs
  permission: Permission;       // checked via can(user, permission, ctx)
  readOnly: boolean;            // read tools skip the write-confirmation gate
  handler: (input, ctx) => Promise<Result>; // calls a core service, never raw SQL
};
```

Rules that make it safe:

- The handler calls an existing `packages/core` service. Tools add no new write paths and inherit every validation and audit the service already has.
- `can(user, permission, ctx)` runs before the handler, every time, for the copilot and MCP alike. Deny by default. RLS is the database backstop.
- Non-`readOnly` tools invoked by the copilot return a **proposed change** the UI renders for approval; over MCP they require a `write` token scope.
- Inputs are Zod-validated (a tool schema is external input). Tool outputs are truncated and recorded in `ai_tool_calls` for audit.

This is the mechanism behind principle 8: define `create_objective` once, and it is available to the human via the UI, to the copilot via the loop, and to the user's external agent via MCP, with identical authorization.

---

## 7. Schema (AI domain "S")

New tables, OpenOKR conventions: `id uuid pk`, `workspace_id uuid` (except the global catalog), `created_at`, `updated_at`, an RLS policy in the same migration, text enums with check constraints. These are **new, no legacy source** (they do not come from either importer). Added to DATABASE.md as domain S.

| Table | Key columns | Notes |
|---|---|---|
| `ai_providers` | `provider`, `base_url?`, `org_id?`, `enabled`, `is_default`, `allow_user_keys bool` | workspace AI connection config |
| `ai_credentials` | `owner_type` (`workspace`/`user`), `owner_id`, `provider`, `key_ciphertext`, `key_hint`, `status` | envelope-encrypted keys; RLS so a user sees only their own; **never** selected to the client |
| `ai_models` | `provider`, `model_id`, `display_name`, `context_window`, `capabilities jsonb`, `cost_in numeric`, `cost_out numeric`, `tiers text[]`, `active` | **global** catalog (no `workspace_id`); seeded + refreshable |
| `ai_model_policies` | `tier` (`fast`/`balanced`/`deep`/`embed`), `provider`, `model_id`, `temperature`, `max_tokens`, `json_mode bool` | per-workspace tier → model routing |
| `ai_feature_settings` | `feature_key`, `enabled bool`, `prompt_id?`, `quota jsonb` | per-feature on/off + limits (§4 card 3/4) |
| `ai_prompts` | `feature_key`, `version int`, `system_prompt text`, `variables jsonb`, `is_default bool` | versioned prompts; workspace override rows over a default row |
| `ai_threads` | `user_id`, `subject_type?`, `subject_id?`, `title` | copilot conversations, optionally anchored to an entity |
| `ai_messages` | `thread_id`, `role` (`system`/`user`/`assistant`/`tool`), `content` (rich), `model`, `tokens_in`, `tokens_out`, `cost_usd` | conversation turns |
| `ai_tool_calls` | `message_id`, `tool_name`, `input jsonb`, `output_excerpt`, `status`, `permission_checked bool`, `duration_ms` | audit of every agent action (copilot + MCP) |
| `ai_usage_events` | `user_id`, `feature_key`, `source` (`copilot`/`mcp`/`assist`/`rest`), `provider`, `model`, `tokens_in`, `tokens_out`, `cost_usd`, `latency_ms`, `status`, `flagged bool` | the metering spine; drives quotas, caps, dashboards |
| `embeddings` | `subject_type`, `subject_id`, `chunk_index`, `content`, `embedding vector(N)`, `model`, `content_hash` | pgvector; GIN/HNSW index; rebuilt by a job on write (§9) |

Scoped tokens for MCP reuse the §8.2 `api_tokens` table (with an `mcp` capability + `read`/`write`/`admin` scopes), not a parallel table. An optional `agent_sessions` (`token_id`, `transport`, `connected_at`, `last_activity`, `client_info jsonb`) is observability only.

---

## 8. Security and safety

AI adds surface area. These controls map to §8.2 of TECHNICAL-PLAN and to specific Phase 5 tasks.

| Control | Detail | Task |
|---|---|---|
| **Tool authorization = user permissions** | every copilot/MCP tool call runs `can()` + RLS as the acting user; deny by default; writes need `write` scope, admin tools need `admin` scope | P5-T06, P5-T09 |
| **Prompt-injection containment** | retrieved and third-party content is untrusted; the permission layer (principle 2) is the backstop so injected instructions cannot exceed the user's rights; RAG chunks are treated as data, not instructions; writes are confirmed | P5-T06, P5-T07 |
| **BYO-key isolation** | user keys are invisible to admins and other users; workspace keys are never sent to the client; decrypt server-side only; keys never logged | P5-T02 |
| **Data governance / egress** | admin controls what context leaves the instance; PII/secret redaction from prompts; egress domain allow-list; no-train provider headers; per-workspace and per-user opt-out; local provider ⇒ zero egress | P5-T02, P5-T10 |
| **SSRF on custom base URLs** | `ollama`/`openai-compatible` base URLs are validated; private-range targets are allowed **only** when the admin explicitly set a local provider (the air-gap case), never inferred from user input | P5-T02, P5-T10 |
| **Cost and abuse limits** | per-token/cost/call quotas, hard caps that disable AI, per-user and per-token rate limits, anomaly flags on `ai_usage_events` | P5-T04 |
| **Audit** | every agent write, every MCP tool call, and every AI settings change emits an `audit_events` row (append-only, §8.2) | P5-T06, P5-T09 |
| **MCP token hygiene** | scoped, named, expiring, rotatable, revocable tokens; last-used tracking; OAuth 2.1 where supported | P5-T09 |
| **No LLM on a required path** | preserved and CI-enforced (§10); AI off ⇒ manual paths intact | P5-T10 |
| **Structured-output validation** | model JSON validated with Zod at the boundary, retried on failure, never `eval`'d | P5-T05 |

---

## 9. Retrieval and embeddings (RAG)

Grounding for the copilot, semantic search, duplicate detection, and grounded wiki/project Q&A.

- **Store:** the `embeddings` table using **pgvector** (a Postgres extension, so "Postgres is the only required service" holds). Index with HNSW for approximate nearest-neighbor at scale.
- **Indexing:** a JobQueue worker chunks and embeds work packages, objectives, key results, KPIs, wiki pages, and comments on write, keyed by `content_hash` so unchanged content is not re-embedded. Embeddings run through the `embed` tier, which can be a **local** model (Ollama `nomic-embed-text`), keeping RAG air-gap-safe.
- **Retrieval:** always **permission-filtered** — the retriever joins to the same access checks as the UI, so the copilot can only surface and cite what the user may read (principle 2). Hybrid ranking combines vector similarity with Postgres full-text search (the Search port).
- **Grounding:** retrieved chunks are passed as *data* with citations; the model is instructed they are untrusted context, not commands (§8 prompt injection).
- **Degradation:** where pgvector is not installed or embeddings are disabled, semantic features fall back to full-text search and the copilot answers without private grounding. The product still works.

---

## 10. Evaluation, quality, and graceful degradation

AI features get the same test discipline as the scoring and scheduling engines.

- **Eval harness.** Golden fixtures per capability: input → expected shape/behavior. Assertions cover JSON-schema validity for every `extract` feature, correct tool selection for agent flows, latency budget, and a no-PII-leak check on prompts. Runs in CI against a **deterministic mock provider**; an optional live smoke against a cheap model runs on demand, never blocking CI.
- **Structured output.** `extract` results are Zod-validated; invalid output triggers one repair retry, then a clean feature-level failure (no partial writes). This replaces regex-scraping model text (§11).
- **Degradation tests.** A CI leg boots with `AI_PROVIDER=off` and asserts every P0 flow passes and every AI affordance is hidden or disabled. This is the machine-checkable form of principle 1 and the "no LLM on a required path" hard rule.
- **Prompt-change gating.** A prompt edit that regresses the eval set fails the check; production prompts move forward only on green.

---

## 11. What we learned from the source product (FlowyTeam / OKRI Learn)

The OKR authoring assists are informed by a shipped OpenRouter-backed implementation. Recording it keeps OpenOKR honest about what to keep and what to fix. Behavior and data only; no code is carried over (clean-room rule).

**Kept (it got these right):** an encrypted stored key; admin-editable system prompts with strong defaults; per-call usage logging with a flag-misuse control; monthly quotas; a clear free-vs-paid capability split; an event emitted per call for analytics.

**Fixed (its gaps, and the OpenOKR answer):**

| Gap in the source | OpenOKR |
|---|---|
| OpenRouter hardcoded; no local model | provider abstraction incl. Ollama / OpenAI-compatible (§3.2) |
| One global platform key only | deployment + workspace + **per-user BYO** keys with precedence (§3.3) |
| Model is unvalidated free text | validated catalog + tier routing; free text still allowed but checked (§3.4) |
| No temperature / JSON mode; JSON recovered by regex | per-tier sampling + JSON mode; Zod-validated structured output with retry (§3.1, §10) |
| `cost_usd` column never populated | real per-token cost from the catalog on every event; caps and dashboards (§4, §7) |
| Quotas count calls, not tokens | quotas by tokens / cost / calls, admin's choice (§4) |
| Two kill switches for all assists | per-feature toggles (§4) |
| Prompts editable but unversioned | versioned prompts with restore-to-default and eval gating (§4, §10) |
| No agent / MCP surface | first-class MCP server + in-app copilot (§5, §6) |
| Doc/UI drift and a dead duplicate settings screen | one settings surface (S-24); the schema is the contract |

---

## 12. Phase 5 tasks (the AI layer)

Task format identical to IMPLEMENTATION-PLAN.md; each inherits the Definition of Done in CLAUDE.md. Estimates S/M/L per IMPLEMENTATION-PLAN. Rows mirror into STATUS.md and the IMPLEMENTATION-PLAN appendix (Phase 5).

**Placement.** Phase 5 opens after **Phase 4** — it needs auth, RBAC, audit, settings, jobs, the app shell, and the OKR and work-management cores its assists build on. Two foundations reach earlier: the AIProvider **port interface** and the `off` driver are delivered in **P1-T04** (so AI is architecturally present in the walking skeleton), and `manage_ai` joins the permission catalogue in **P2-T01**. The per-module *assist* tasks (P5-T11, P5-T12) close the phase because they depend on both the AI foundation and their module cores: P5-T11 on Phase 4's OKR core, P5-T12 on Phase 3's work-package/meeting/wiki cores.

| Task | Title | Depends on | Goal (one line) |
|---|---|---|---|
| P5-T00 | AI design gate [DESIGN GATE] | Phase 4 | design docs 14–16 (ai-architecture, mcp-server, ai-safety); human approves "Design approved for Phase 5" |
| P5-T01 | AIProvider port full surface + drivers | P1-T04 | chat/stream/tools/embed/extract/capabilities; anthropic/openai/google/openrouter/ollama/openai-compatible/off; contract tests on both runtimes |
| P5-T02 | AI config + BYO-key + encryption | P5-T01, P2-T07 | `ai_providers`/`ai_credentials`, envelope encryption, precedence resolver, test-connection, Provider card (S-24) |
| P5-T03 | Model catalog + routing | P5-T02 | `ai_models` catalog (seed+refresh+validate), `ai_model_policies` tiers, sampling/JSON-mode config |
| P5-T04 | Usage + cost metering + quotas + caps | P5-T02, P1-T04 | `ai_usage_events`, cost from catalog, token/cost/call quotas, hard caps auto-disable, usage dashboard + logs |
| P5-T05 | Structured output + prompt registry | P5-T03 | `extract` with Zod validation + retry; `ai_prompts` versioned + editor; per-feature settings/toggles |
| P5-T06 | Tool registry + agent authz + confirmation | P5-T05, P2-T02 | core tool registry (Zod + per-tool permission), tool-use loop, write preview/confirm, `ai_tool_calls` audit, deny-by-default + RLS backstop |
| P5-T07 | Embeddings + RAG | P5-T01, P3-T26 | pgvector `embeddings`, indexing job, permission-filtered hybrid retrieval, FTS degradation |
| P5-T08 | In-app copilot | P5-T06, P5-T07, P2-T11 | `ai_threads`/`ai_messages`, copilot SidePanel (S-25), streaming, grounded answers + confirmed actions, degradation |
| P5-T09 | MCP server (inbound) | P5-T06, P4-T19, P2-T12 | stdio + Streamable HTTP, scoped-token auth (extends §8.2), per-user identity + RLS + `can()`, tool/resource/prompt catalog, rate limit, audit, token admin (S-24), connect docs |
| P5-T10 | AI eval + safety harness + CI | P5-T05, P5-T06 | golden fixtures, mock provider, schema/tool/latency/no-leak asserts, `AI_PROVIDER=off` degradation leg, egress allow-list + redaction + base-URL SSRF checks |
| P5-T11 | OKR AI authoring + coaching | P5-T06, P4-T04, P4-T05 | the §2.1 assists (generate/rate/improve/suggest/align/check-in draft/coach) on the AI foundation; upgrades the source product's feature |
| P5-T12 | Work / project AI assists + NL-query | P5-T06, P5-T07, P3-T08, P3-T16, P3-T23 | the §2.2/§2.3 assists (WP summary, decomposition, draft WP, meeting summary→action items, wiki draft/Q&A, NL→query DSL, status narrative) |

**Phase 5 exit checklist:** the AIProvider port works on both runtimes with at least one hosted and the local (Ollama) driver; a workspace admin can configure a provider, bring a key, route tiers, toggle features, set budgets, and see usage/cost; a user can bring their own key where allowed; the tool registry enforces `can()` + RLS for every action; the in-app copilot answers grounded and applies confirmed writes; the **MCP server** lets an external agent create/update/check-in as the authenticated user within scope and is fully audited; embeddings/RAG run (locally where required) and degrade to FTS; the eval harness is green and the `AI_PROVIDER=off` leg proves every P0 flow still works; OKR authoring assists (P5-T11) and work/meeting/wiki assists (P5-T12) are live; every AI table ships `workspace_id` + RLS; no secret is logged.

---

## 13. AI open decisions (ask the human, do not guess)

Handled the way PLAN.md §12 handles open decisions: a lean is recorded, the human confirms before the dependent design gate (P5-T00).

| # | Decision | Options | Lean |
|---|---|---|---|
| A1 | Default posture | off by default / **on where a provider is configured**, per feature | on-where-configured (this is what "AI-native" means; no key ⇒ behaves like today) |
| A2 | AI in open core vs a paid tier | fully open / gate advanced AI (copilot, MCP) behind the enterprise pack | fully open; revisit with the §12 business-model decision |
| A3 | Which drivers ship in v1 | subset / all seven | anthropic + openai + openrouter + **ollama** + openai-compatible + off in v1; google fast-follow |
| A4 | Per-user BYO keys | allow / workspace-key only | allow, admin-toggleable per workspace (§3.3) |
| A5 | Eval bar to ship a capability | define pass thresholds per feature | set at P5-T00 with the design docs |
| A6 | Outbound MCP (OpenOKR calls external MCP tools) | v1 / later | later (§5.4); design the registry so it is a bolt-on |
| A7 | Embedding dimension + index | fix `N` and HNSW params | decide at P5-T07 against the chosen `embed` model; keep the column swappable |

---

## 14. Where the rest of the plan set covers this domain

One map so nothing is duplicated and nothing is missed. Keep these in sync when this file changes (the same-PR rule in CLAUDE.md). This is the update contract that makes AI genuinely woven in rather than a side document.

| Document | What it holds for this domain | Change to make |
|---|---|---|
| REQUIREMENTS.md §3, §4 | AI as a native capability across modules; MCP as an integration surface; the copilot | elevate the AI cross-cutting need and per-module AI notes from "optional summary" to §2's catalog; add MCP-server row |
| PLAN.md §2, §4, §8, §10, §12 | the AI-native principle; the AIProvider port row; Data-and-AI; the delivery phase; the decision register | add principle; expand §8; note the port is config-selected; add Phase 5; add A1–A7 |
| TECHNICAL-PLAN.md §5, §8.2, §15, §4 | the elevated port; the AI security controls; the scorecard row; the schema pointer | widen the §5 port row; add §8.2 AI controls; rewrite the §15 AI row; point §4 to this doc's domain S |
| TECHNICAL-PLAN.md §4.12 + IMPLEMENTATION-PLAN.md Phase 4 | AI hooks on OKR tables; P5-T11; P4-T19's relationship to the MCP server | note AI-generated provenance columns; P5-T11 indexed in Phase 5 |
| UIUX-PLAN.md §4, §6, §9 | AI interaction patterns; screens S-24 (admin AI), S-25 (copilot); inline assist affordances; the quality gates AI UI runs | add the AI patterns and the S-24/S-25 specs |
| IMPLEMENTATION-PLAN.md Phase 5 | the task index and the appendix entries | the Phase 5 section indexes §12 |
| DATABASE.md domain S | the AI tables (§7) | add domain S to the map and relationship view |
| STATUS.md | the live Phase 5 task rows | the P5-T00…P5-T12 rows |
| CLAUDE.md | authority order (this file), the AI hard rules, the locked stack (AI SDK + MCP) | insert into the authority list; rewrite the AI rule to the native-not-dependent form; add the stack entries |
| `reference/flowyteam-okr-kpi-tasks-model.md` §8 | the canonical REST/MCP field shapes the server mirrors | read-only reference; no change |

---

## 15. Phase 5 exit contract (mirror of §12 checklist, for the phase gate)

Before Phase 5 is marked complete, the human verifies, live:

- [ ] Configure `anthropic` (or `openai`/`openrouter`), run an OKR draft, see a validated result and a cost recorded.
- [ ] Switch the same workspace to `ollama` with a local model, disconnect the network, and repeat: the draft still works (air-gap proof).
- [ ] Set `AI_PROVIDER=off`: every AI affordance disappears and creating an objective, a KPI, and a work package by hand all still work.
- [ ] As a non-admin user, bring a personal key (where the admin allowed it) and confirm usage bills to that key.
- [ ] Connect an external MCP client with a `read` token: it can list objectives but a create attempt is refused; rotate to a `write` token and the create succeeds, as that user, within that user's permissions, and both attempts appear in the audit log.
- [ ] Exceed a cost cap and confirm AI auto-disables with a clear message while manual paths continue.
- [ ] Every new AI table has an RLS policy; no key or full prompt with PII appears in any log.
