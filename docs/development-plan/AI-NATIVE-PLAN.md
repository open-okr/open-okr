# AI-NATIVE-PLAN.md

The plan for OpenOKR's AI and agent layer: the two built-in coaching agents that make the product active, assists in every module, an in-app copilot, chat channels that carry the coach to where people work, and an MCP server so any external agent can drive OpenOKR safely. Multi-provider with bring-your-own-key and local models, per-token metering with hard caps, and governance that an enterprise can sign off.

Authority: peer of TECHNICAL-PLAN.md for this domain. Both defer to PLAN.md, REQUIREMENTS.md and METHOD.md. Where the question is *what good practice is*, METHOD.md decides and this document implements it.

---

## 1. The stance

1. **The agents are the product's opinion made active.** Every message the Coach or the Champion sends maps to a rule in METHOD.md and cites it. They do not have opinions of their own. A user can argue with a nudge, and the argument is about the rule, not about the model.
2. **Native, never dependent.** Every AI feature accelerates a complete manual path. The quality rules, the alignment score, the health corridors, the diagnostics, the nudges and the escalations are all deterministic and run with the provider off. AI adds rewriting, semantic judgement, natural language and drafting. CI proves the product is whole with AI disabled.
3. **Every AI action runs under a concrete principal.** Assists, the copilot and MCP calls act as the human, through the same `can()` and row-level security as a click. The Coach and the Champion act as their own agent member with least-privilege bindings scoped to named spaces and goals. There is no service account with ambient authority.
4. **Propose by default.** Interactive AI proposes and the human confirms, with a preview and an undo. Autonomous agents produce proposals into a review queue by default. A workspace may grant a named agent scoped direct writes. Sandbox mode is always available and commits nothing.
5. **Bring your own brain.** Deployment, workspace admin or individual user chooses the provider and supplies the key. Anthropic, OpenAI, OpenRouter, Ollama or any OpenAI-compatible endpoint. An air-gapped installation points at a local model or turns AI off, including the agents.
6. **Nothing leaves silently.** An admin controls what context may reach a non-local provider, personal-data redaction, an egress allow-list and no-training headers. A local provider means zero egress, and the interface says so.
7. **Cost is visible and capped.** Every call records tokens and cost. Quotas per user, per agent and per workspace. A hard cap halts a run mid-flight with a clear log line.
8. **Structured output is validated, never trusted.** Model output passes Zod with one repair attempt, then fails cleanly. The model is an untrusted source, and so is everything it retrieved.
9. **One contract, every consumer.** The copilot, the agents, the chat channels, MCP, REST and the command line all invoke the same action registry. An action is defined once and permission-checked identically everywhere.
10. **Nudges are a budget, not a firehose.** Every proactive message is a recorded row with a rule, a channel and an escalation step. Volume is measurable, suppressible and subject to quiet hours. An agent that annoys people is a failure, not a feature.

## 2. The capability catalogue

Each capability accelerates an existing manual action, is independently toggleable, and follows the §1.4 write policy.

### 2.1 Planning and drafting

| Capability | Kind | Degrades to |
|---|---|---|
| Draft an objective and key results from a plain-language ambition | write | The blank create form and the deterministic Draft Coach |
| Rewrite a failing objective or key result to satisfy the rule it broke | write | The rule's coaching prompt and its example pair |
| Suggest metrics, units, baselines and targets for a key result | write | Manual entry |
| Suggest the alignment parent by meaning | write | The manual picker and the structural finding |
| Turn a priority into candidate objectives at the right level | write | Manual promotion |
| Summarise the input pack into a diagnosis briefing | read | Read the documents |
| Propose strategic issues from KPI baselines and the prior cycle's scores | write | Manual entry |

### 2.2 Running the rhythm

| Capability | Kind | Degrades to |
|---|---|---|
| Draft the overdue check-in from real activity: value movement, completed linked work, comments since the last check-in | write | A blank check-in |
| Draft the weekly digest from the session record | write | The deterministic digest template |
| Summarise blockers and risks across a space, ranked by age and impact | read | The blocker board |
| Flag reported-health versus data divergence in plain language | read | The deterministic divergence flag |
| Narrate a KPI trend and call out anomalies | read | The chart |
| Draft a recovery objective and key results for an unhealthy KPI | write | The deterministic recovery drafter |

### 2.3 Reviewing and learning

| Capability | Kind | Degrades to |
|---|---|---|
| Draft the goal retrospective from check-in history | write | A blank retrospective |
| Cluster retro notes into themes before dot voting | read | Read the notes |
| Draft the review minutes from the session record | write | The deterministic minutes template |
| Narrate the rhythm diagnostic with specifics from this cycle | read | The deterministic verdict sentence |
| Propose next-cycle objectives from the learnings marked to carry forward | write | Manual drafting |
| Detect duplicate and conflicting goals across the organisation | read | The structural alignment findings |

### 2.4 Working across the product

| Capability | Kind | Degrades to |
|---|---|---|
| Decompose a key result into initiatives and tasks | write | Manual creation |
| Grounded question answering across everything the user may see, with citations | read | Full-text search |
| Turn a sentence into a validated list filter | read | Manual filters |
| Summarise a thread or a document | read | Read it |
| Map spreadsheet columns to import fields | write | Manual mapping |

## 3. Architecture

### 3.1 The AIProvider port

One interface in `packages/adapters`. Vendor SDKs live only there.

| Method | Purpose |
|---|---|
| `chat` / `stream` | Completion and token streaming |
| `chatWithTools` | Native tool calling. Drives the copilot and the agent loops |
| `embed` | Vectors for retrieval |
| `extract` | Structured output, validated by the caller with Zod |
| `capabilities(model)` | Tools, vision, JSON mode, context window, embedding dimensions, streaming, so features adapt or degrade |

Selected per request by stored configuration: user key, then workspace, then deployment, then off.

### 3.2 Provider drivers

| Provider | Notes |
|---|---|
| `anthropic` | Claude family. Prompt caching. No-training posture |
| `openai` | GPT family. JSON mode |
| `openrouter` | Many models behind one key, with attribution headers |
| `ollama` | Local. The air-gap default. Local embeddings |
| `openai-compatible` | Generic base URL and key for self-hosted inference servers |
| `off` | No-op. Every capability reports unavailable and features degrade |

### 3.3 Bring your own key

Precedence per call: user key, then workspace configuration, then deployment environment, then off. Keys are envelope-encrypted with per-secret data keys wrapped by a master key ring, so rotation re-wraps data keys only and costs nothing. Keys are never sent to the client and never logged. The interface shows a masked hint and a live connection test.

### 3.4 Model catalogue and tier routing

Features request a **tier**, never a model.

| Tier | Used for |
|---|---|
| `fast` | Classification, cleanups, mapping suggestions, short rewrites |
| `balanced` | Most assists, summaries, drafts, digests |
| `deep` | OKR critique, semantic alignment review, decomposition, agent reasoning, the diagnostic narrative |
| `embed` | Retrieval |

A global model catalogue records context window, capabilities, cost in and out, and tier tags. A per-workspace policy maps each tier to a provider and model with sampling settings. Free-text model identifiers are allowed but validated against the live list when reachable. A context-window guard blocks oversized requests. An air-gapped installation maps every tier to a local model.

## 4. Governance surface

Permission `manage_ai`. One admin console:

| Card | Contents |
|---|---|
| Provider and connection | Provider, base URL, key, connection test, allow per-user keys |
| Models and routing | The tier map, sampling, context guard |
| Features | A switch per §2 capability, on by default where a provider is configured |
| Coaching | Draft Coach strictness (advisory, warn, strict), which publish gates are hard, per-space overrides |
| Agents | Create and edit agents: persona, instructions per phase, provider and tier, schedule, access scope, autonomy policy, sandbox toggle, run history and logs |
| Nudges | Per-rule enable and channel, escalation ladders, workspace quiet mode, per-member quiet hours defaults, a live volume chart with the top noisy rules |
| Budgets and limits | Token, cost and call quotas per user, per agent and per workspace. A hard cap that halts runs. A throttle window |
| Prompts | Versioned system prompt per feature and per agent phase, restore to default, gated by the evaluation set |
| Privacy and governance | Context egress level, personal-data redaction, no-training assertion, egress allow-list. Greyed out with a zero-egress note on a local provider |
| Channels | Connect Slack, Teams, WhatsApp and Telegram, verify, map identities, test send |
| Connections | MCP clients and grants with last-used and audit links, revoke |
| Usage and logs | Token and cost dashboards by user, feature, agent and model. A request log with truncated payloads. Flagged calls. Latest evaluation results |

## 5. Channels

Reference mockup: [09-channels](../stakeholder/mockups/png/09-channels.png), showing the same nudge in all four channels with its trigger key and escalation position. Reference, not authority: UIUX-PLAN.md §10.

The coach is only active if it reaches people. Channels are the delivery layer for everything in §6 and a light command surface for the actions people take most.

### 5.1 The port

One `Channel` port, one driver per provider, all behind the same interface (TECHNICAL-PLAN.md §5). A workspace connects a provider once, members link their identity once, and every nudge, digest and escalation routes by member preference.

### 5.2 What each provider supports in v1

| Provider | Outbound | Inbound | Notes |
|---|---|---|---|
| Email | Everything, HTML and plain text, one-click action links | Not in v1 | Always available. The fallback for every other channel |
| Slack | Rich blocks with buttons, threads, per-space channel posts, direct messages | Slash commands and button actions | Self-serve installation. The first provider after email |
| Microsoft Teams | Adaptive cards, channel posts, direct messages | Commands and card actions | Requires tenant-admin consent |
| WhatsApp | Approved templates outside the conversation window, free-form inside it | Free-form conversational replies | Business API. Templates are pre-registered per nudge kind |
| Telegram | Messages with inline keyboards | Commands and callback actions | Simplest to operate. Useful where WhatsApp is unavailable |

### 5.3 The command surface

Generated from the action registry, so a chat command is the same action as a button:

| Command | Does |
|---|---|
| Check in | Walks the member through their due check-ins: status, confidence, one line of narrative, key result values. Conversational on WhatsApp and Telegram, a modal on Slack and Teams |
| Blocker | Logs a blocker on a key result: type, owner, next action. Starts the 24-hour clock |
| Status | Returns a goal, a key result, a space or the member's own review inbox |
| Ack | Acknowledges a check-in awaiting the member's review |
| Commit | Sets or closes a weekly commitment |
| Ask | Sends the message to the copilot, grounded and permission-filtered |
| Snooze | Quiets nudges for a stated period, never the review inbox |

Every inbound message is signature-verified, resolved to a linked member, rate-limited, run through `can()`, and recorded with the channel named in the audit entry. An unlinked sender receives nothing at all, because a helpful error would confirm the workspace exists.

### 5.4 Routing and volume

- Each member has a primary channel and quiet hours in their own timezone.
- A nudge outside quiet hours goes to the primary channel. Inside them it queues to the next open window, unless it is an escalation the workspace has marked as urgent.
- One nudge per subject per member per day, except when the escalation step increases.
- A workspace quiet mode silences everything except escalations.
- Snoozing a nudge never silences the review inbox. The obligation stays visible in the product.

## 6. The coaching agents

Two agents ship with every workspace. They are workspace members with `kind = 'agent'`, they appear in feeds and mentions, and they are accountable like anyone else. Both are on by default where a provider is configured, and both keep a reduced deterministic form when it is not: with AI off they still nudge, escalate, compute and cite rules. They lose only the language.

### 6.1 The OKR Coach

**Owns quality and practice.** Its whole vocabulary is METHOD.md.

| Runs | On |
|---|---|
| Continuously | Every write to a goal, key result, alignment link or cycle field |
| At each phase transition | The cycle's phase completion and its blocking items |
| Nightly | The semantic sweep: duplicates, conflicts, divergence, drift |
| On demand | A requested review of a goal, a space or the whole tree |

What it does:

1. **Evaluates every draft** against the METHOD.md §4 catalogue and writes the result to the goal's quality score and flags. This part is deterministic. With a provider configured it adds a suggested rewrite for each failing rule.
2. **Runs the semantic alignment review** (METHOD.md §5.3) and writes relink, dependency, conflict and gap findings alongside the structural ones, each with a severity, a specific reason and a one-click apply where the fix is mechanical.
3. **Watches for divergence**: a goal reported on track whose key results have not moved, a set whose average confidence contradicts its status, a forecast that misses while the champion says caution.
4. **Guards the gates**: when a facilitator tries to publish, it explains exactly which of the six gates is not met and what to do about it.
5. **Speaks at the moments that matter**: at Phase 3 exit if the not-doing list is empty, at Phase 4 if every key result is lagging, at Phase 5 if nothing was cut, at the close if the scores cluster near 1.0.
6. **Delivers the rhythm diagnostic** at the quarterly review, with specifics from the cycle rather than the generic sentence.

Every message carries the rule key, so the recipient can open the rule and disagree with it. A dismissed finding stays dismissed.

### 6.2 The OKR Champion

**Owns rhythm and momentum.**

| Runs | On |
|---|---|
| Hourly | The nudge queue: what is due now, per member, per channel |
| Daily | The morning summary in each member's local timezone, the staleness sweep, blocker aging, KPI corridor checks |
| Weekly | Opening and closing the session, assembling the digest, updating the streak |
| Per cycle | The planning countdown and the quarterly review preparation pack |

What it does:

1. **Chases check-ins.** Reminds before the due date, on the day, and daily after, escalating up the ladder.
2. **Chases acknowledgements.** A published check-in with no acknowledgement after a day is a reviewer nudge, and after three days an escalation.
3. **Runs the blocker clock.** At twenty hours it warns the owner. At twenty-four it escalates to the coordinator, then to the sponsor. It never re-opens a discussion, it moves the clock.
4. **Opens and closes the weekly session.** Posts the agenda, collects confidence from members who cannot attend, marks the session held or skipped, updates the streak, publishes the digest.
5. **Watches the KPI corridors.** When a KPI drops below the watch threshold it tells the owner. When it drops below the unhealthy threshold for two periods it drafts the recovery OKR and proposes it.
6. **Prepares the sessions.** Before a quarterly review it assembles the pack: scores ready to confirm, missed key results awaiting a cause, retro prompts, the process-health survey, and the draft minutes skeleton.
7. **Runs the planning countdown.** As the publication deadline approaches it tells the sponsor and the facilitator what is missing, phase by phase, week by week.

### 6.3 The escalation ladder

Configurable per workspace. The default:

| Step | After | Goes to |
|---|---|---|
| 1 | Due date reached | The champion or the owner |
| 2 | 1 day overdue | The champion again, on their primary channel |
| 3 | 3 days overdue, or grace exceeded | The reviewer, and the goal renders outdated |
| 4 | 7 days overdue | The space coordinator |
| 5 | 14 days overdue | The cycle sponsor |

Blockers run a faster ladder against their 24-hour clock: owner at 20 hours, coordinator at 24, sponsor at 48. Confidence at or below 0.3 escalates to the coordinator immediately.

Escalation is always visible to the person being escalated past. Nobody is reported behind their back.

### 6.4 The full trigger catalogue

Every proactive message the product sends. Each row is a rule key, and each writes a nudge record.

**Rhythm triggers, owned by the Champion**

| Rule | Fires | Recipient |
|---|---|---|
| `checkin.due_soon` | 1 day before the anchor day | Champion |
| `checkin.due` | On the anchor day | Champion |
| `checkin.overdue` | Daily past the due date, escalating | Champion, then the ladder |
| `checkin.stale` | Grace exceeded | Champion and reviewer. The goal renders outdated |
| `ack.owed` | 1 day after publication | Reviewer |
| `ack.overdue` | 3 days after publication | Reviewer, then the ladder |
| `blocker.warning` | 20 hours after opening | Blocker owner |
| `blocker.overdue` | 24 hours after opening | Coordinator |
| `blocker.escalated` | 48 hours after opening | Sponsor |
| `confidence.critical` | A key result scored at or below 0.3 | Coordinator, same day |
| `commitment.due` | End of the commitment week | Owner |
| `session.due_soon` | 1 day before the weekly session | Coordinator and space |
| `session.open` | At the scheduled start | Space |
| `session.missed` | 1 day after a missed session | Coordinator, then sponsor |
| `streak.at_risk` | The week would break the streak | Coordinator |
| `digest.weekly` | After the session closes | Space and leadership |
| `digest.daily` | The member's local morning | Everyone opted in |
| `kpi.watch` | A KPI enters the watch corridor | KPI owner |
| `kpi.unhealthy` | A KPI leaves the healthy corridor | KPI owner and sponsor |
| `kpi.recovery_proposed` | Unhealthy for two periods | KPI owner, with a drafted recovery OKR |
| `kpi.recovered` | Achievement re-enters the healthy corridor | KPI owner, proposing to close the recovery OKR |
| `cycle.planning_opens` | Six weeks (annual) or three weeks (quarterly) before the start | Sponsor and facilitator |
| `cycle.phase_blocked` | A phase's completion conditions are unmet as its window closes | Facilitator |
| `cycle.deadline` | 14, 7 and 1 days before the publication deadline | Sponsor and facilitator |
| `cycle.starts` | Day one | Everyone |
| `cycle.review_due` | Two weeks before the cycle ends | Facilitator |
| `cycle.closing` | The cycle ends unscored | Facilitator and sponsor |

**Quality triggers, owned by the Coach**

| Rule | Fires | Recipient |
|---|---|---|
| `quality.draft_failing` | Live as a draft is written | The author, inline |
| `quality.gate_blocked` | On a publish attempt | Facilitator |
| `quality.no_not_doing` | Phase 3 completion without a not-doing list | Sponsor and facilitator |
| `quality.too_many_objectives` | A level exceeds its cap | Facilitator |
| `quality.all_lagging` | An objective's key results are all lagging | Champion |
| `quality.no_baseline` | A key result lacks a baseline at Phase 4 exit | Champion |
| `quality.sandbagging_draft` | Average draft confidence above 0.9 | Champion and facilitator |
| `quality.sandbagging_close` | Scores cluster above 0.85 at the close | Sponsor |
| `quality.orphan_goal` | A goal below company level has no parent | Champion |
| `quality.level_skip` | Alignment skips a level | Champion |
| `quality.silo` | A department subtree has no horizontal dependency | Department lead |
| `quality.conflict` | Two goals double-count or oppose, from the semantic sweep | Both champions |
| `quality.dependency_unowned` | A dependency is unconfirmed with no risk owner | Champion |
| `quality.no_cuts` | Capacity checked with nothing cut | Facilitator |
| `quality.divergence` | Reported health disagrees with the data | Champion and reviewer |
| `quality.trending_off` | The forecast misses the target | Champion |
| `quality.process_health_low` | A process-health statement scores low at review | Sponsor, as next cycle's process priority |

### 6.5 Agent definition and runs

- **Identity.** An agent row owns a member record with `kind = 'agent'`. It has a name, an avatar and a profile, and appears in feeds, mentions and audit like anyone. The Coach and the Champion ship as seeded agents; a workspace may create more.
- **Definition.** A persona, staged instructions (planning and execution) that are versioned like prompts, a provider and tier choice, a schedule, an autonomy policy, a sandbox flag and an access scope.
- **Least privilege.** The agent's member group gets explicit bindings on named spaces, goals and KPI trees only. Read-only by default with per-resource write grants. Never a workspace-wide grant.
- **Runs.** A durable state machine: planning, running, then completed, failed or cancelled, with a task list. The planning phase decomposes the work. The execution phase pops one task per job, runs a bounded tool loop, appends a human-readable log, and reschedules itself until done. Runs resume across restarts, and every tool call carries the run identifier.
- **Write policy.** `sandbox` returns simulated results and commits nothing. `propose` (the default) turns every write into a proposal envelope queued to the review inbox, where a human applies or dismisses in bulk. `scoped_direct` commits immediately within the agent's bindings, still fully audited.
- **Cost.** Every step meters under the agent. Per-agent and per-workspace caps halt a run mid-flight with a clear log line.
- **Conversation.** An agent is addressable. Mention the Coach on a goal and it reviews that goal and replies in the thread.

## 7. Schema

Conventions from TECHNICAL-PLAN.md §3 and §4 apply. Credentials and token hashes are never selected to the client.

| Table | Key columns |
|---|---|
| `ai_providers` | provider, base URL, enabled, allow user keys |
| `ai_credentials` | owner (workspace or user), provider, key ciphertext, key hint, status |
| `ai_models` (global) | provider, model identifier, context window, capabilities, cost in and out, tiers, active |
| `ai_model_policies` | tier to provider, model, sampling and JSON mode |
| `ai_feature_settings` | feature key, enabled, quota |
| `ai_prompts` | feature key or agent identifier and phase, version, system prompt, default flag |
| `ai_threads` / `ai_messages` | Copilot and agent conversations anchored to a subject, roles, tokens, cost |
| `ai_tool_calls` | message or run reference, tool, input, output excerpt, status, permission checked, duration |
| `ai_usage_events` | member or agent, feature, source (copilot, mcp, assist, agent, rest, channel), provider, model, tokens, cost, latency, status, flagged |
| `embeddings` | subject, chunk, content, vector, model, content hash |
| `agents` | member reference, definition, planning instructions, execution instructions, provider and tier, schedule, autonomy (`sandbox` / `propose` / `scoped_direct`), scope, enabled, built-in kind (`coach` / `champion` / `custom`) |
| `agent_runs` | agent, trigger, status, tasks, append-only log, started and finished, error, cost |
| `proposed_changes` | run, action, payload envelope, subject, status (`pending` / `applied` / `dismissed`), decided by and when |
| `nudge_rules` | rule key, enabled, channel override, escalation ladder override, quiet-mode exempt |
| MCP authorisation | `oauth_clients`, `oauth_grants`, `oauth_codes`, `oauth_access_tokens`, `oauth_refresh_tokens` with rotation lineage, `mcp_sessions` |

The `nudges` and `channel_*` tables live in TECHNICAL-PLAN.md §4.11, because they serve notifications as well as agents.

## 8. The MCP server

Any external agent drives OpenOKR as the authenticated user.

### 8.1 Shape

| Aspect | Decision |
|---|---|
| Role | OpenOKR is the server. The user's agent is the client |
| Transports | Streamable HTTP for hosted clients, and standard input and output for local or air-gapped desktop agents |
| Authentication | OAuth 2.1 authorisation code with PKCE for the HTTP transport. Scoped tokens remain for local and scripted use |
| Identity | One grant is one user and one workspace, chosen at a consent and workspace-picker screen. Tool schemas never take a workspace identifier |
| Enforcement | Every call resolves the acting member, applies the tenant setting, and runs the registry's `can()`. Write tools need write scope. Admin tools need admin scope and the underlying permission. Membership and suspension are revalidated per request, and losing membership revokes the grant |
| Limits and audit | Per-token rate limits and cost caps. Every call writes a tool-call row and an audit event |
| Egress | The MCP server makes no outbound AI calls of its own, so it is air-gap safe by construction |

### 8.2 The authorisation server

- Endpoints for authorise (sign in, pick a workspace, consent), token (code and refresh grants) and dynamic client registration.
- Discovery documents for protected-resource metadata, authorisation-server metadata and OpenID configuration, each with the transport-suffixed variants and cross-origin preflight. Unauthorised responses carry a challenge pointing at the resource metadata.
- Clients: a static allow-list, client metadata documents, and dynamic registration. Every client metadata fetch goes through the outbound-request rules. Native-application redirect rules are enforced, with custom schemes allowed only to the callback path and dangerous schemes denied. Redirects must use transport security in production. Public clients only.
- Tokens: single-use authorisation codes consumed in a transaction, short-lived access tokens, refresh tokens that rotate on every use with reuse detection that revokes the whole grant lineage, and resource binding validated at issue and on every request so an API token is not an MCP token. Every secret is stored as a hash with a type prefix.
- Sessions: the session identifier is bound to the grant, protocol version is negotiated, header discipline is enforced, origin is validated against rebinding, and errors are sanitised.

### 8.3 What the server exposes

- **Tools**, generated from the action registry, spanning the whole product: cycles and phases, goals and key results, check-ins and acknowledgement, blockers, commitments, sessions, KPIs and records, alignment, initiatives, tasks, documents, comments and search. Each carries a read-only or destructive hint, a safety class, scopes, schemas and examples. Lifecycle and destructive actions are included and pinned by a catalogue invariant test. Plus a global permission-filtered `search` and a `fetch` that turns a canonical OpenOKR URL into structured content with a citation, so research connectors work.
- **Resources**: read-only handles for a goal, a cycle, a scorecard, a KPI tree or a slice of the Work Map.
- **Prompts**: server-side templates such as "run my weekly check-in", "review this quarter's OKRs against the canon", "prepare my quarterly review", "what do I owe this week".

## 9. Retrieval

pgvector with no new service. An outbox-driven worker chunks and embeds goals, key results, check-ins, blockers, sessions, documents, comments and cycle artifacts on write, keyed by content hash. Retrieval is always access-filtered through the same layer as reads, with hybrid ranking against full text. Local embeddings keep retrieval air-gap safe. Chunks are passed as cited, untrusted data. Where pgvector is unavailable, semantic features degrade to full text and everything still works.

## 10. Evaluation, quality and degradation

- **Evaluation harness.** Golden fixtures per capability against a deterministic mock provider, asserting schema validity, tool selection, latency and the absence of personal data in prompts. An optional live smoke test on a cheap model, never blocking CI.
- **Method conformance.** The Coach's rule citations are checked against `packages/method`. A message that cites a rule the package does not define fails the build.
- **Degradation leg.** CI boots with the provider off and asserts every P0 flow passes, every AI affordance is hidden or disabled, and both agents still nudge, escalate and compute.
- **Live transport tests.** Drive the real authorisation and transport stack end to end and assert that an under-privileged call is denied and no cross-tenant data appears in any result. The claim that every call is permission-checked is machine-verified, not asserted.
- **Prompt gating.** A prompt version that regresses the evaluation set fails the check.
- **Agent safety tests.** Sandbox commits nothing. Proposal mode commits nothing until applied. A cost cap halts a run mid-flight. An instruction injected into retrieved content cannot exceed the agent's bindings.
- **Nudge tests.** Deduplication holds under bursts. Quiet hours defer. Escalation advances exactly one step. A snooze never hides a review-inbox obligation. Volume per member per week stays under the configured ceiling in a simulated month.

## 11. Phase task index

Task bodies for the AI and agent work live in IMPLEMENTATION-PLAN.md alongside everything else, in Phase 2 (the provider and agent spine), Phase 4 (the coaching layer) and Phase 5 (channels and MCP). This document is the design authority they cite.

## 12. Open decisions

| # | Decision | Position |
|---|---|---|
| A1 | Default posture | On per feature where a provider is configured |
| A2 | Drivers in v1 | Anthropic, OpenAI, OpenRouter, Ollama, OpenAI-compatible and off |
| A3 | Per-user keys | Allowed, admin-toggleable |
| A4 | Evaluation pass bar per capability | Set with the design documents |
| A5 | Agent default autonomy | Propose and approve. Scoped direct writes require admin opt-in per agent |
| A6 | Embedding model and dimension | Decide at the retrieval task. Keep the column swappable |
| A7 | Nudge volume ceiling per member per week | Start at ten, measure in the pilots, make it a workspace setting |
| A8 | Outbound MCP, meaning the copilot calling external tools | Later. The registry is designed so it bolts on |
