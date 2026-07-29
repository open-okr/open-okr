# AI-NATIVE-PLAN.md

The plan for OpenOKR's **AI layer**: AI built into every module from day one, an in-app copilot, **AI teammates** (autonomous agent members that plan and execute on the operating cadence), and an **MCP server with a full OAuth 2.1 authorization server** so any external agent drives OpenOKR safely. Multi-provider with bring-your-own-key and local models, per-token cost metering with hard caps, and a governance surface Operately does not have.

Authority: peer of TECHNICAL-PLAN.md for the AI domain; both defer to PLAN.md and REQUIREMENTS.md. §12 is the execution authority for Phase 5.

Honesty note (from the competitive review, OPERATELY-COMPARISON.md §3.6): on the inbound MCP server and autonomous agents, **Operately is ahead of the original draft of this plan** — it ships a ~100-tool MCP server behind a spec-complete OAuth 2.1 flow, and cron-scheduled autonomous agents modeled as real members. This revision therefore treats Operately's shipped design as the **reference spec to match** on those two surfaces (clean-room: behavior, not code — TECHNICAL-PLAN §11), and concentrates OpenOKR's original effort where it genuinely leads: **provider freedom, governance (keys, metering, caps, prompts, egress), local/air-gapped AI, RAG, and safety controls for autonomy** (least privilege, sandbox, batch approval) that Operately lacks.

---

## 1. The AI-native stance (principles, ranked)

1. **Native, not dependent.** Every AI feature is an accelerator over a complete manual path. Remove AI and the product works end to end. CI enforces it (§10).
2. **Every AI action runs under a concrete principal — never ambient authority.** Interactive assists and MCP calls act as the human user, through the same `can()` + RLS as a click. **AI teammates act as their own agent member** (`workspace_members.kind = 'ai'`) with **least-privilege bindings** scoped to named spaces/goals — never a workspace-wide grant (Operately's agents get company-wide edit access; we fix that). Either way, authorization is the backstop that makes prompt injection non-catastrophic.
3. **Bring your own brain.** Deployment, workspace admin, or individual user chooses the provider and supplies the key: Anthropic, OpenAI, OpenRouter, or a **local model** (Ollama, vLLM, LM Studio, any OpenAI-compatible endpoint). Google fast-follow. No provider hardcoded. Air-gapped installs point at a local model or turn AI off — including autonomous teammates.
4. **Write policy is per mode, not absolute.** *Interactive* AI (assists, copilot, MCP as a user) proposes; the human confirms, with preview/diff and undo. *Autonomous* AI teammates execute unattended **within policy**: default is **batch-approval** (the run produces proposed writes into a review queue), with an admin-selectable scoped direct-write mode for trusted agents — always sandboxable, always cost-capped, always audited. This resolves the old plan's contradiction that forbade the autonomy Operately ships.
5. **Nothing leaves the instance silently.** Admin controls what context may go to a non-local provider, PII redaction, an egress allow-list, no-train headers. Local provider ⇒ zero egress, and the UI says so.
6. **Cost is visible and capped.** Every call records tokens and cost. Quotas (tokens / cost / calls) per user, per agent, per workspace; **hard caps auto-disable** — an unattended teammate can never run an unbounded bill (Operately's agents have zero metering).
7. **Structured output is validated, never trusted.** Model JSON passes Zod with one repair retry, then a clean failure. The model is an untrusted source; so is everything it retrieved.
8. **One contract, every consumer.** The copilot, the AI teammates' executor, the MCP server, REST, and the CLI all invoke the same action registry in `packages/core` (TECHNICAL-PLAN §14). Define `create_goal` once; it is permission-checked identically everywhere.

## 2. The capability catalog

Each capability is an accelerator over an existing manual action, uses a §3 port capability, is independently toggleable (§4), and follows the §1.4 write policy.

### 2.1 Strategy (Phase 5 assists over the Phase 3 core)

| Capability | Kind | Degrades to |
|---|---|---|
| Draft a goal + KRs from a plain-language ambition (rate/improve/coach variants) | write | blank create form |
| Suggest metrics, targets, units; suggest the alignment parent (semantic, via embeddings) | write | manual pickers |
| **Draft the overdue check-in from real activity** (linked work-item movement, KR value history, comments since last check-in) | write | blank check-in |
| Summarize blockers/risks across a team's check-ins; narrate a cycle | read | read the list |
| Draft the close retrospective from check-in history | write | blank retro |
| Suggest KPIs + thresholds; build a calculated-KPI formula from a sentence; narrate a KPI trend / flag anomalies | write/read | manual builder / read the chart |
| Duplicate/conflicting-goal detection across the org (embeddings) | read | none |

### 2.2 Execution (over the Phase 4 core)

| Capability | Kind | Degrades to |
|---|---|---|
| Draft a work item from a sentence; decompose a goal into work items | write | blank form |
| Summarize a thread; draft a project status narrative; flag reported-health vs data divergence ("on_track but 3 milestones slipped") | read | read it yourself |
| Draft/expand/summarize a document; summarize an uploaded file | write/read | the editor |
| Grounded Q&A across goals/projects/docs (permission-filtered citations) | read | full-text search |
| Natural-language filter ("at-risk goals in Marketing this quarter") → validated list query | read | manual filters |

### 2.3 The three agent surfaces

1. **Copilot (interactive).** §6.1 — answers grounded in workspace data, proposes actions for confirmation.
2. **AI teammates (autonomous).** §6.3 — agent members with personas that run scheduled plan/execute loops on the cadence.
3. **External agents over MCP.** §5 — the user's own agent (Claude, ChatGPT, Cursor, custom) acting as that user.

## 3. AI architecture

### 3.1 The AIProvider port

One interface in `packages/adapters`; vendor SDKs live only there (the Vercel AI SDK + the MCP TypeScript SDK are the approved internals).

| Method | Purpose |
|---|---|
| `chat` / `stream` | completion / token streaming |
| `chatWithTools` | native tool calling; drives the copilot and teammate loops |
| `embed` | vectors for §9 |
| `extract` | structured output (JSON mode where supported), Zod-validated by the caller |
| `capabilities(model)` | `{tools, vision, jsonMode, contextWindow, embeddingDims, streaming}` so features adapt or degrade |

Selected by **stored config per request** (user key → workspace → deployment → off), not the `RUNTIME` var.

### 3.2 Provider drivers

| Provider | Notes |
|---|---|
| `anthropic` | Claude family; prompt caching; no-train posture |
| `openai` | GPT family; JSON mode |
| `openrouter` | many models, one key; attribution headers |
| `ollama` | local; base-URL setting; **the air-gap default**; `nomic-embed-text` for embeddings |
| `openai-compatible` | generic base-URL + key: vLLM, LM Studio, LiteLLM, Groq, Together |
| `google` | fast-follow (§13 A3) |
| `off` | no-op; every capability reports unavailable; features degrade |

### 3.3 Bring-your-own-key precedence

Deployment env (`AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`) → workspace config (admin UI) → per-user key (if the workspace allows; bills the user, used especially for their MCP/agent traffic). Resolution per call: user → workspace → deployment → off. Keys are envelope-encrypted (per-secret data keys wrapped by a master **key ring**; rotation re-wraps data keys only, zero-downtime — TECHNICAL-PLAN §8.2), never sent to the client, never logged; a masked hint + a live "Test connection".

### 3.4 Model catalog and tier routing

Features request a **tier**, never a model: `fast` (cleanups, classification) / `balanced` (most assists, summaries) / `deep` (OKR critique, decomposition, teammate reasoning) / `embed`. `ai_models` is a global catalog (context window, capabilities, cost in/out, tier tags; seeded + refreshable from live model lists); `ai_model_policies` maps `(workspace, tier) → (provider, model, sampling, json_mode)`. Free-text model ids are allowed but validated against the live list when reachable; a context-window guard blocks oversize requests. Air-gapped installs map every tier to a local model.

## 4. Admin surface (screen S-24)

Permission `manage_ai`. Cards: **Provider & connection** (incl. allow-user-keys); **Models & routing** (tier map, sampling); **Features** (a switch per §2 capability, default-on where a provider is configured); **Budgets & limits** (token/cost/call quotas per user / per agent / per workspace; a hard cost cap that auto-disables; throttle window); **Prompts** (versioned system prompt per feature, restore-to-default, eval-gated changes); **Privacy & governance** (context egress level, PII redaction, no-train assertion, egress allow-list, per-workspace opt-out; greyed with a "zero egress" note on local providers); **Agents** (create/edit AI teammates: persona, planning + execution instructions, provider/tier, schedule, access scope, sandbox toggle, autonomy policy, run history); **MCP & connections** (enable server, connected clients/grants with last-used + audit links, revoke); **Usage & logs** (token/cost dashboards by user/feature/agent/model, request log with truncated payloads, flag-misuse, latest eval results).

## 5. The MCP server (external agents drive OpenOKR)

Reference spec: Operately's shipped server (behavior, not code). Where the original draft under-specified this, the corrected requirements below are mandatory — a PAT-paste-only MCP cannot onboard hosted connectors at all.

### 5.1 Shape

| Aspect | Decision |
|---|---|
| Role | OpenOKR is the server; the user's agent is the client |
| Transports | **Streamable HTTP** (hosted connectors) and **stdio** (local/air-gapped desktop agents — a capability Operately lacks) |
| Auth (primary) | **OAuth 2.1 authorization-code + PKCE (S256)** — required for the HTTP transport. Scoped PATs remain as the stdio/scripts fallback only |
| Identity | one grant = one user + one workspace, chosen at a **consent + workspace-picker** screen (tool schemas never take a workspace id) |
| Enforcement | every tool call resolves the acting member, sets the RLS GUC, and runs the action registry's `can()`; write tools need `write` scope; admin tools need `admin` scope **and** the underlying permission; live membership + suspension revalidated per request; membership loss revokes the grant |
| Rate + audit | per-token rate limits (Cache port) + cost caps (§4); every call writes `ai_tool_calls` + an audit event |
| Egress | the MCP server makes no outbound AI calls of its own — air-gap safe by construction |

### 5.2 The OAuth 2.1 authorization server (mandatory sub-spec)

- Endpoints: `/oauth/authorize` (login → workspace picker → consent), `/oauth/token` (code + refresh grants), `/oauth/register` (RFC 7591 dynamic client registration).
- Discovery: RFC 9728 protected-resource metadata, RFC 8414 authorization-server metadata, OpenID-configuration (ChatGPT), each with `/mcp`-suffixed variants and CORS preflight; 401s carry a `WWW-Authenticate` challenge pointing at the resource metadata.
- Clients: static allowlist + **CIMD** (client-id metadata documents) + DCR — CIMD/DCR fetches go through the SSRF-safe fetcher (port-443 only, literal **and** DNS-resolved address checks, no redirects, size/time caps); RFC 8252 native-app redirect rules (custom schemes allowed to `/oauth/callback` only; `javascript:`/`data:`/`file:` denied); HTTPS-only redirects in production; public clients only (`token_endpoint_auth_method=none`).
- Tokens: authorization codes single-use (consumed in a transaction); access tokens ~15 min; refresh tokens ~30 days with **rotation on every use and reuse-detection that revokes the entire grant lineage**; RFC 8707 resource/audience binding validated at issue and on every request (an `/api/v1` token is not an MCP token); **all secrets stored as SHA-256 hashes with type prefixes**.
- Sessions: `mcp-session-id` bound to the grant (cross-grant/closed → unknown), protocol-version negotiation and header discipline (Accept both `application/json` + `text/event-stream` else 406; content-type else 415; GET → 405; DELETE closes), Origin/DNS-rebinding validation (strict same-origin on localhost binds), sanitized errors (JSON-RPC errors at HTTP 200 for domain failures; real HTTP codes for transport violations).

### 5.3 What the server exposes

- **Tools** — the action registry's projections across *both* pillars (goals, KRs, check-ins + acknowledge, KPIs + records, projects, milestones, work items, documents, comments, search), each carrying `readOnlyHint`/`destructiveHint`, a safety classification, scopes, schemas and examples; lifecycle + destructive actions included (close/reopen/pause/archive/delete) and pinned by a catalog-invariant test. Plus connector-grade **`search`** (global, permission-filtered) and **`fetch`** (canonical OpenOKR URL → structured content + citation markdown; same-origin + path-allowlist validated) so ChatGPT/Claude research connectors work.
- **Resources** — read-only handles (a goal, a project, a cycle scorecard, a work map slice) — a primitive Operately does not expose.
- **Prompts** — server-side templates ("Run my weekly check-in", "Draft next quarter's OKRs for team X", "Summarize this week") — also beyond Operately.

## 6. The agentic layer

### 6.1 The copilot (interactive)

A side panel (⌘J / "Ask AI", screen S-25): grounded answers via §9 (citations only to what the user may see), actions through the registry with preview → apply → undo, streaming with Stop. Turns that trigger long tool sequences execute as background jobs (outbox → JobQueue) and stream back over Realtime, so they survive reloads and are watchable. Degrades cleanly when AI is off.

### 6.2 The action registry (shared)

TECHNICAL-PLAN §14. For AI consumers the registry adds: per-tool safety class, write-confirmation gating for interactive mode, proposed-change envelopes for batch approval, `ai_tool_calls` audit, and Zod input/output validation. Tools add no new write paths — every handler is a core service through the Operation pipeline.

### 6.3 AI teammates (autonomous agents — the headline)

Reference behavior: Operately's agents (Person-typed members, plan/execute phases, daily cron, sandbox), upgraded with the governance Operately lacks.

- **Identity.** An `agents` row owns a `workspace_members` record with `kind='ai'`: the agent has a name, avatar, profile, and appears in feeds, mentions, assignments and audit like anyone. It can be a goal's champion or a project contributor.
- **Definition.** Persona (`definition`), **staged instructions** (`planning_instructions`, `execution_instructions`) — versioned like prompts, unlike Operately's plain columns — provider/tier choice, schedule (`daily_run` on working days, or cron), autonomy policy, sandbox flag, access scope.
- **Least privilege.** The agent's member group gets explicit bindings on named spaces/goals/projects only — default read-only with per-resource write grants. Never a workspace-wide grant.
- **Runs.** `agent_runs` is a durable state machine (`planning → running → completed/failed/cancelled`) with a `tasks jsonb` list: the planning phase decomposes work via an `add_task` tool; the execution phase pops one task per job, runs a bounded tool loop, appends a **human-readable log** (verbose toggle), and self-reschedules via the JobQueue until done. Resumable across restarts; every tool call carries the `run_id`.
- **Write policy per §1.4.** `sandbox` — write tools return simulated results, nothing commits (full dry-run). `batch_approval` (default) — writes become proposed-change envelopes queued to a review inbox section; a human applies/dismisses in bulk next morning. `scoped_direct` — writes commit immediately within the agent's bindings (for trusted, narrow agents), still fully audited.
- **Cost.** Every step meters into `ai_usage_events` under the agent; per-agent and workspace caps **halt a run mid-flight** with a clear log line.
- **Conversation.** An agent is also conversable (mention it on a goal/project); turns process async and broadcast, anchored to the entity.

## 7. Schema (AI domain; DATABASE.md domains M/N)

OpenOKR conventions apply (workspace_id + RLS in the same migration; no legacy provenance). `ai_credentials` and all token hashes are never selected to the client.

| Table | Key columns |
|---|---|
| `ai_providers` | provider, base_url?, enabled, allow_user_keys |
| `ai_credentials` | owner (workspace/user), provider, key_ciphertext (envelope), key_hint, status |
| `ai_models` *(global)* | provider, model_id, context_window, capabilities, cost_in/out, tiers, active |
| `ai_model_policies` | tier → provider+model+sampling+json_mode |
| `ai_feature_settings` | feature_key, enabled, quota jsonb |
| `ai_prompts` | feature_key or agent_id+phase, version, system_prompt, is_default |
| `ai_threads` / `ai_messages` | copilot + agent conversations (anchored via subject), roles, tokens, cost |
| `ai_tool_calls` | message_id?/run_id?, tool, input, output_excerpt, status, permission_checked, duration |
| `ai_usage_events` | member/agent, feature, source (copilot/mcp/assist/teammate/rest), provider, model, tokens, cost, latency, status, flagged |
| `embeddings` | subject, chunk, content, vector(N) (pgvector, HNSW), model, content_hash |
| `agents` | member_id, definition, planning_instructions, execution_instructions, provider/tier, schedule, autonomy (`sandbox`/`batch_approval`/`scoped_direct`), enabled |
| `agent_runs` | agent_id, status, tasks jsonb, logs text (append-only), started/finished, error, cost_usd |
| `proposed_changes` | run_id, action, payload (the registry envelope), status (`pending`/`applied`/`dismissed`), decided_by/at |
| MCP OAuth | `oauth_clients` (registered + CIMD cache), `oauth_grants` (user+workspace+client, revoked_at), `oauth_codes` (hash, PKCE challenge, resource, consumed_at), `oauth_access_tokens` / `oauth_refresh_tokens` (hashes, resource, expiry, rotation lineage: used_at/replaced_by), `mcp_sessions` (grant_id, protocol_version, closed_at; last-seen throttled) |

## 8. Security and safety

| Control | Detail |
|---|---|
| Principal-bound authority | every AI call runs as a concrete member (human or agent) through the registry's `can()` + RLS; deny by default; no service-account superuser exists |
| Prompt injection | retrieved/RAG/tool-returned content is data, never instructions; the principal's bindings bound the blast radius; autonomous writes go through sandbox/batch-approval policy; destructive tools require elevated scope + confirmation even for `scoped_direct` agents |
| Key handling | envelope encryption + key ring + cheap rotation; user keys invisible to admins; decrypt server-side only; never logged |
| Egress | context-level controls, PII redaction, allow-list, no-train headers; local provider ⇒ zero egress; base-URL and CIMD fetches SSRF-hardened (literal + resolved addresses) |
| Cost/abuse | per-user/per-agent/per-workspace quotas; hard caps auto-disable and halt runs; per-token rate limits; anomaly flags |
| OAuth hygiene | §5.2 in full — hashes at rest, rotation + reuse-detection lineage revocation, audience binding, consent, revoke-on-membership-loss, Origin validation |
| Token administration | token/OAuth-authed callers cannot mint, rotate, escalate or revoke tokens (403); session-auth only |
| Audit | every agent write, MCP call, settings change and cap event → `ai_tool_calls` + append-only `audit_events` |
| No LLM on a required path | preserved and CI-enforced (§10) |

## 9. Retrieval and embeddings (RAG)

pgvector (`embeddings`, HNSW) — no new service; an outbox-driven worker chunks and embeds goals, check-ins, work items, documents, discussion posts and comments on write (content-hash keyed). Retrieval is **always access-filtered** through the same layer as reads; hybrid rank with FTS. Local embedding (Ollama `nomic-embed-text`) keeps RAG air-gap safe. Chunks are passed as cited, untrusted data. Where pgvector is unavailable, semantic features degrade to FTS and everything still works.

## 10. Evaluation, quality, degradation

- **Eval harness:** golden fixtures per capability against a deterministic mock provider (schema validity, tool selection, latency, no-PII-in-prompt asserts); optional live smoke on a cheap model, never blocking CI.
- **Degradation leg:** CI boots `AI_PROVIDER=off` and asserts every P0 flow passes and every ✨/copilot/agent affordance is hidden or disabled.
- **Live-transport e2e (new, mandatory):** drive the real OAuth/PKCE + Streamable HTTP MCP stack and the REST token surface end to end; assert an under-privileged tool call is denied by `can()`/RLS and no cross-tenant data appears in any result. The "every tool call is permission-checked" claim is machine-verified, not asserted.
- **Prompt gating:** a prompt version that regresses the eval set fails the check.
- **Teammate safety tests:** sandbox produces zero committed writes; batch-approval commits nothing until applied; a cost cap halts a mid-run agent; an injection fixture in retrieved content cannot exceed the agent's bindings.

## 11. What we learned from the source products

**From FlowyTeam/OKRI (kept/fixed as before):** encrypted stored key, admin-editable prompts, per-call logging, monthly quotas kept; OpenRouter-hardcoding, single global key, unvalidated model text, regex-scraped JSON, stub cost column, two kill switches, unversioned prompts all fixed by §3–§4.

**From Operately (the new reference):** *adopt* — agents as real members; plan/execute phased runs with readable logs; sandbox mode; scheduled daily runs; the full OAuth 2.1 flow (PKCE, rotation + lineage revocation, resource indicators, CIMD, consent/workspace picker, discovery incl. ChatGPT variants); search+fetch connector tools; per-tool safety classification; tools delegating to the same permission-checked API as the UI. *Fix* — company-wide agent edit grants (→ least-privilege bindings); zero cost metering on agents (→ §1.6); cloud-only providers (→ local models); no batch-approval middle ground (→ §6.3); scopes enforced only in app code (→ RLS backstop); unversioned agent instructions (→ versioned); no MCP Resources/Prompts primitives, no stdio (→ §5.3).

## 12. Phase 5 tasks

Format and DoD as IMPLEMENTATION-PLAN.md; estimates S/M/L. Rows mirror into STATUS.md. Foundations reaching earlier: the AIProvider port interface + `off` driver ship in P1-T04; `manage_ai` joins the permission catalogue in P2-T01; the action registry itself exists from P1-T07 (tRPC projection) — Phase 5 adds the public projections.

| Task | Title | Depends on | Goal (one line) |
|---|---|---|---|
| P5-T00 | AI design gate [DESIGN GATE] [L] | Phase 4 | design docs (ai-architecture, mcp-oauth, teammates-safety); §13 decisions confirmed; human approves |
| P5-T01 | AIProvider port full surface + drivers [L] | P1-T04 | chat/stream/tools/embed/extract/capabilities; anthropic/openai/openrouter/ollama/openai-compatible/off; contract tests |
| P5-T02 | AI config + BYO keys + encryption + rotation [M] | P5-T01 | providers/credentials, envelope + key ring, precedence resolver, test-connection, rotation command |
| P5-T03 | Model catalog + tier routing [M] | P5-T02 | seeded/refreshable catalog, tier policies, context-window guard |
| P5-T04 | Usage metering + quotas + hard caps [M] | P5-T02 | ai_usage_events, cost from catalog, per-user/agent/workspace quotas, auto-disable + run-halt, dashboards |
| P5-T05 | Structured output + prompt registry [M] | P5-T03 | extract with Zod+retry; versioned prompts + editor + eval gating; per-feature toggles |
| P5-T06 | Public contract projections: REST + OpenAPI + CLI + MCP tool defs [L] | P1-T07, P4 core | generate /api/v1 + OpenAPI 3.1 + the CLI + the MCP tool catalog from the action registry; scoped hashed tokens; drift CI |
| P5-T07 | Embeddings + RAG [L] | P5-T01, P4-T08 | pgvector + indexing worker + access-filtered hybrid retrieval + FTS degradation |
| P5-T08 | In-app copilot [L] | P5-T06, P5-T07 | threads/messages, side panel, streaming, grounded citations, preview→apply, background tool runs |
| P5-T09 | MCP OAuth 2.1 authorization server [L] | P5-T06, P2-T09 | §5.2 in full: endpoints, PKCE, discovery, DCR/CIMD + SSRF-safe fetch, rotation + reuse detection, resource binding, consent + workspace picker, revoke-on-membership-loss |
| P5-T10 | MCP server: transport, sessions, catalog [L] | P5-T09 | Streamable HTTP + stdio, session lifecycle + header discipline, tool catalog with safety classes + invariant test, search+fetch, Resources + Prompts, rate limits |
| P5-T11 | AI teammates: agents + runs + approvals [L] | P5-T04, P5-T06 | agent members, least-privilege bindings, plan/execute runs on JobQueue, readable logs, sandbox, batch-approval inbox, scheduler, cost-halt |
| P5-T12 | AI eval + safety harness + live e2e [L] | P5-T05, P5-T10, P5-T11 | mock-provider evals, AI-off leg, MCP/REST live-transport authz e2e, teammate safety tests, egress/redaction/SSRF checks |
| P5-T13 | Strategy AI assists [M] | P5-T06, P3 core | §2.1: draft/improve/coach goals, check-in + retro drafts, KPI suggestions + formula-from-text, trend narration; provenance |
| P5-T14 | Execution AI assists + NL query [M] | P5-T06, P5-T07, P4 core | §2.2: work-item drafts, decomposition, status narrative + divergence flag, doc drafting/Q&A, NL→filters |

**Phase 5 exit checklist:** a hosted **and** the local (Ollama) driver work; admin can configure providers, route tiers, toggle features, set budgets, watch usage; a user can bring a personal key where allowed; the copilot answers grounded and applies confirmed writes; an external MCP client onboards **via OAuth end to end** (consent → tools; read scope denied writes; rotation + reuse detection proven) and stdio works air-gapped; an AI teammate runs a scheduled sandbox run, then a batch-approval run whose proposals a human applies; a cost cap halts a run; the AI-off leg is green; every AI table ships RLS; no secret in any log.

## 13. AI open decisions (confirm at P5-T00)

| # | Decision | Lean |
|---|---|---|
| A1 | Default posture | on where a provider is configured, per feature |
| A2 | AI in open core vs paid | fully open; revisit with the business-model decision |
| A3 | Drivers in v1 | anthropic + openai + openrouter + ollama + openai-compatible + off; google fast-follow |
| A4 | Per-user BYO keys | allow, admin-toggleable |
| A5 | Eval pass bar per capability | set with the design docs |
| A6 | Teammate default autonomy | `batch_approval`; `scoped_direct` requires admin opt-in per agent |
| A7 | Embedding model + dimension | decide at P5-T07; keep the column swappable |
| A8 | Outbound MCP (copilot calling external MCP tools) | later; registry designed so it bolts on |
