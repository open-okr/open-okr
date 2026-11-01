# Integrations

| | |
|---|---|
| URL | `/product/integrations` |
| Audience | Admins, IT, developers, and anyone asking "does it work with what we use?" |
| The page's one job | List every connection honestly, and show that each one is two-way and permission-checked |
| Primary CTA | Start free |
| Secondary CTA | Read the API docs |
| Page title | Integrations: Slack, Teams, WhatsApp, Telegram, your AI agent, SSO and API · OKRGoal |
| Meta description | OKRGoal reaches people in Slack, Microsoft Teams, WhatsApp, Telegram and email, connects to Claude, ChatGPT and your own agents over MCP, and brings your own AI model. Plus SSO, SCIM, a REST API, a CLI and importers. |

## Section structure

| # | Section | Layout |
|---|---|---|
| 1 | Hero | H1, subhead, logo cloud |
| 2 | Chat | Five channel cards, then the channels image |
| 3 | Your own agent | Code tabs, consent explanation, example prompts |
| 4 | Your own AI model | Provider logos and four governance lines |
| 5 | API and command line | Code block and three facts |
| 6 | Identity | SSO and directory sync |
| 7 | Bring your data | Importers, and export |
| 8 | Infrastructure | Mail, storage, database |
| 9 | Not yet | Honest list |
| 10 | Final CTA | |

---

## 1. Hero

**Eyebrow:** Integrations

# It comes to you.

People do not open an OKR tool on a Thursday afternoon. So OKRGoal goes where they already are: their chat app, their inbox, and the AI agent they already use. Every connection is two-way, and every action that comes back in runs through the same permission checks as a click.

**Logo cloud, grouped:**

- **Chat:** Slack · Microsoft Teams · WhatsApp · Telegram · Email
- **Your agent:** Claude · ChatGPT · Cursor · Hermes Agent · any MCP client
- **AI models:** Anthropic · OpenAI · Google · OpenRouter · Ollama · any OpenAI-compatible endpoint
- **Identity:** OIDC · SAML 2.0 · SCIM 2.0 (Okta, Microsoft Entra ID)
- **Data:** CSV · Excel

## 2. Chat

## Check in from the app you already have open.

**Image:** the same practice on four channels ([09-channels.png](../../mockups/png/09-channels.png)).

**Five cards:**

| Channel | What people can do |
|---|---|
| **Slack** | Get nudged. Check in from a dialog. Log a blocker. Acknowledge a check-in. Read a goal. Ask the Coach. Get the weekly digest in the team channel |
| **Microsoft Teams** | The same, in adaptive cards |
| **WhatsApp** | Get nudged, then check in by replying, as a conversation. Through the WhatsApp Business API |
| **Telegram** | The same, with inline buttons |
| **Email** | Nudges, digests, a daily summary in your own time zone, and one-click check-in links |

**Three lines under the cards:**

- **Two-way.** Nudges go out. Check-ins, blockers and acknowledgements come back in.
- **Checked.** Every inbound message is verified against the provider's signature, matched to a member, and run through the same permission checks as the browser. A stranger gets nothing.
- **Optional.** A workspace with no chat app connected still works completely. Email and the browser cover everything.

## 3. Your own agent

**Eyebrow:** Agent-native

## Your agent, your permissions.

Everything a person can do in OKRGoal, an agent can do, through one contract. OKRGoal is a Model Context Protocol server, so Claude, ChatGPT, Cursor, Hermes Agent or your own agent can connect, sign in as you through a consent screen, and work within your permissions. Nothing more.

**Code tabs, with copy buttons:** `Claude Code` · `Hermes Agent` · `ChatGPT` · `Local agent`

```sh
# Claude Code
claude mcp add --transport http openokr https://app.okrgoal.com/api/mcp
# Then run /mcp, choose openokr and sign in.
```

```yaml
# Hermes Agent: ~/.hermes/config.yaml
mcp_servers:
  openokr:
    url: "https://app.okrgoal.com/api/mcp"
    auth: oauth
```

```text
ChatGPT (developer mode)
Settings → Apps and Connectors → Advanced settings → Developer mode.
Create a connector named OpenOKR with the server URL and OAuth, then sign in.
```

**Caption under the tabs:** Easier still: in the product, one button copies a setup prompt. Paste it into your agent and it connects itself. There is no token to copy, so nothing secret lands in your clipboard.

**Four facts:**

| Signs in properly | Covers the whole product | Audited | Local and offline |
|---|---|---|---|
| OAuth 2.1 with a consent screen and a workspace picker. Scoped tokens for scripts | Cycles, goals, key results, check-ins, blockers, sessions, KPIs, alignment, initiatives, tasks, documents and search | Every call is rate-limited, cost-capped, and written to the audit log | Desktop agents can connect over standard input and output, with no network exposure at all |

**Example requests, as chat bubbles:**

- "What do I owe this week?"
- "Run my weekly check-in."
- "Review this quarter's OKRs against the method."
- "Prepare my quarterly review."

> **Decision needed:** the cloud agent endpoint. `app.okrgoal.com/api/mcp` is a placeholder.

## 4. Your own AI model

## Bring your own brain.

The deployment, the workspace admin or each person chooses the provider and supplies the key. Features ask for a tier, fast, balanced or deep, never a model, so swapping models is one setting.

**Provider row:** Anthropic · OpenAI · Google · OpenRouter · Ollama · any OpenAI-compatible endpoint · Off

**Four lines:**

- **Nothing leaves silently.** Choose what context may reach a provider, redact email addresses and phone numbers, and allow-list the hosts it may call.
- **Local means local.** Point it at Ollama or your own inference server and nothing leaves your network. The admin screen says so.
- **Cost is visible and capped.** Every call records its tokens and cost. Quotas per person, per agent and per workspace, and a hard cap that halts a run.
- **Or none at all.** Choose "Off" and the whole practice still runs. You lose the drafting and the language, nothing else.

## 5. API and command line

## One contract. Every surface generated from it.

Every read and write in OKRGoal is defined once, with its schema and the access level it needs. The REST API, its OpenAPI document, the command line, the agent tools and the chat commands are all generated from that one definition, and checked for drift on every change. So the API can do exactly what the product can, and nothing slips past a permission check.

**Code block:**

```sh
okr login --url https://app.okrgoal.com
okr goals list --mine
okr goals recordValue --id <key-result-id> --value 1400000 --note "Two enterprise deals closed"
```

**Three facts:**

- **REST and OpenAPI.** The OpenAPI document is served live by every instance, so it describes the version you are running.
- **A command line.** `okr` signs in with a device code you approve in the browser. Read and write by default, never destructive unless you ask.
- **Scoped tokens.** Create, scope and revoke API tokens from your account.

**Button:** `[ Read the API docs ]`

## 6. Identity

## Single sign-on, included.

| Single sign-on | Directory sync | Sign-in for everyone else |
|---|---|---|
| OIDC and SAML 2.0, connected directly | SCIM 2.0, so Okta, Microsoft Entra ID and others add and remove people for you | Passwords, passkeys, and authenticator codes with backup codes. Enforce a second factor for the whole workspace |

**Line under the table:** Single sign-on is in the open source edition and on every cloud plan. It is not an enterprise upsell.

## 7. Bring your data

## Start with what you already have.

| Spreadsheets | FlowyTeam | Another instance |
|---|---|---|
| Upload a CSV or Excel file of goals, key results, KPIs, KPI readings, initiatives or tasks. Download a template, or let the AI suggest the column mapping. You confirm it, see a dry run with a report for every row, then import | A dedicated, read-only importer: people, spaces, cycles, objectives, key results with history, check-ins, KPIs with their formulas, initiatives, tasks, comments and files. Run it twice and nothing changes | Export a whole workspace to a signed, encrypted archive. Import it into any other instance, cloud or self-hosted, in either direction, after a dry run |

**Line under the table:** Every derived number, such as progress, health and streaks, is recomputed after import rather than trusted. Anything that cannot map cleanly is named in the report, never quietly dropped.

## 8. Infrastructure

## Fits the stack you run.

For self-hosters. In the cloud, we run all of this.

| Need | Options |
|---|---|
| Database | PostgreSQL, the only service OpenOKR requires |
| Mail | Any SMTP server, set up from the admin screen |
| File storage | Local disk, MinIO, or any S3-compatible service |
| Observability | OpenTelemetry, to a backend you host |
| Deploy | Docker Compose, or a Helm chart on your Kubernetes |

## 9. Not yet

## What it does not connect to, yet.

Designed for, not built: Discord, Google Chat and LINE; incoming email; links to GitHub and GitLab work; two-way calendar sync. If one of these would decide it for you, tell us. It moves up the list.

**Button:** `[ Request an integration on GitHub ]`

## 10. Final CTA

## Bring the Champion into your team's chat.

**Buttons:** `[ Start free ]` `[ Read the API docs ]`
