# The agent setup prompt

A button that copies a prompt. A member pastes it into their own AI agent, and
the agent connects itself to this instance's agent endpoint. Requested by the
product owner on 26 October 2026. Authority: AI-NATIVE-PLAN.md §8,
[agent-surface.md](agent-surface.md) §2 and §5, UIUX-PLAN.md S-01.

## 0. What already exists

| Component | Where | What it gives this change |
|---|---|---|
| The agent endpoint, OAuth with dynamic registration | `/api/mcp`, `/api/mcp/register`, `/oauth/authorize` | An agent can connect with no token: the member approves it in the browser |
| The agent token (`mcp` audience) | `/account/api-tokens` | A bearer for an agent that cannot open a browser |
| `agentConfiguration(endpoint, token)` | `apps/web/app/account/api-tokens/agent-config.ts` | The `mcpServers` JSON shown on the token page |
| `resourceIdentifier(instanceIssuer())` | `packages/core` | The one endpoint address every grant is checked against |

**What does not exist.** No copy button anywhere in the product, and no text
written for an agent to read rather than a person.

## 1. Two prompts, one builder

| Prompt | Carries | Shown on | Why |
|---|---|---|---|
| OAuth prompt | The endpoint address only | Work Map (S-01) and the token page's "Connect an agent" card | No secret, so it is safe on the front door and safe in a clipboard history |
| Token prompt | The endpoint and a freshly minted agent token | The token page, only in the answer that minted an `mcp` token | For an agent with no browser. The token exists only in that answer, so this prompt does too |

One pure function builds both: `agentSetupPrompt({ endpoint, token? })` in
`apps/web/lib/agent-setup-prompt.ts`, because the Work Map and the token page
both read it. No token means the OAuth prompt.

**The prompt is English and is not translated.** It is read by an agent, not
shown to a person, and every agent named below reads English. The button
label, the tooltip and the "Copied" status are UI text and go through `t()`.

## 2. What the prompt says

Addressed to the agent. It names the server, then gives the exact step for
each supported agent, and asks the agent to do the step for its own runtime.

| Agent | OAuth prompt step | Token prompt step |
|---|---|---|
| Claude Code | `claude mcp add --transport http openokr <endpoint>`, then `/mcp` to sign in | Same, with `--header "Authorization: Bearer <token>"` |
| Hermes Agent | Add to `~/.hermes/config.yaml` under `mcp_servers.openokr`: `url: <endpoint>` and `auth: oauth` | `url` plus `headers.Authorization: Bearer <token>` |
| ChatGPT, developer mode | Settings, Apps and Connectors, Advanced, developer mode on, then create a connector with the endpoint and OAuth | Not supported: ChatGPT connectors take OAuth only. The token prompt says so |
| Gemini CLI | `gemini mcp add --transport http openokr <endpoint>`, then `/mcp auth openokr` | Same, with `--header "Authorization: Bearer <token>"` |

The prompt closes with: "When the connection is added, call
`workspace.overview` once and report the workspace name, so I know it
worked." `workspace.overview` is a read tool in the default `core` toolset
(`packages/core/src/api/mcp/toolset-data.ts`), so it works with a read-only
token and with no `?toolsets=` parameter.

**ChatGPT cannot run the step itself.** A pasted prompt there gets the steps
back as instructions for the person. That is acceptable and the prompt does
not pretend otherwise.

**Gemini CLI is listed as untested** by the product owner. It stays in the
prompt; the changeset says it was not verified against a live client.

## 3. The Work Map pill

| Element | Rule |
|---|---|
| Place | S-01, directly below the Work Map header, above the first-visit tour and the scope tabs |
| Content | "Connect your AI agent to {instanceName}", four generic icons (one per agent), and a close button. The instance's own name, not "OpenOKR", per the catalogue rule M-33 |
| Icons | Generic lucide icons, no brand marks: `Terminal` Claude Code, `Bot` Hermes Agent, `MessageSquare` ChatGPT, `Sparkles` Gemini CLI. Each has an accessible name with the agent's name |
| Click | Copies the OAuth prompt. The label changes to "Copied" for two seconds, announced through `aria-live="polite"` |
| Tooltip | "Copies a setup prompt for your AI agent", as the button's `title` |
| Close | Hides the pill for the rest of the login session |
| Who | Every member. The endpoint enforces each member's own access |
| AI provider off | Still shown. The agent endpoint does not depend on the instance's AI provider |

**Dismissal is per login session, kept in `localStorage`.** The key is
`openokr.agentPrompt.dismissed`, the value is the current session's id. The
pill hides when the stored value equals the current session id. A new sign-in
has a new id, so the pill returns. Nothing is written to the server: this is a
per-browser convenience, and a lost value only means the pill shows again.
Every read and write is wrapped, because storage can be blocked. The rule is
`apps/web/lib/agent-prompt-dismissal.ts`; the pill renders nothing until it
has mounted and read storage, so a closed pill never flashes.

The session id is passed from the server component as a prop. It is the
Better Auth session row id, never the session token.

## 4. The token page

| Place | Change |
|---|---|
| "Connect an agent" card | A copy button for the OAuth prompt, above the existing JSON |
| The minted-token answer, `mcp` audience | A copy button for the token prompt, beside the existing JSON |

The existing JSON blocks stay unchanged, so nothing a current reader relies on
moves.

## 5. The copy button

`CopyButton` in `packages/ui`, a client component.

| State | Shown |
|---|---|
| Idle | The label |
| Copied | "Copied", for two seconds, announced politely |
| Clipboard refused | "Copy failed, select the text below", announced as an alert, and the prompt text is revealed in a read-only text area so it can be copied by hand |

`navigator.clipboard.writeText` needs a secure context. An instance served on
plain HTTP from a LAN address has none, so the refused state is a real path,
not an edge case.

## 6. Acceptance criteria

**Given** a member on the Work Map with no dismissal stored,
**when** they click the pill,
**then** the clipboard holds the OAuth prompt with this instance's endpoint and
no token, and "Copied" is announced.

**Given** a member closed the pill,
**when** they reload or move between screens in the same login session,
**then** the pill is not shown.

**Given** a member closed the pill,
**when** they sign out and sign in again,
**then** the pill is shown.

**Given** a member mints an agent token,
**when** they click the copy button in the answer,
**then** the clipboard holds the token prompt, containing that token once in
each header step and naming ChatGPT as OAuth-only.

**Given** a member mints a REST token,
**when** the answer renders,
**then** no setup-prompt button is shown.

**Given** the clipboard is refused,
**when** a member clicks any copy button,
**then** the failure is announced and the prompt is shown for manual copy.

## 7. Tests

| Test | Kind |
|---|---|
| The builder: endpoint present in every step; token absent from the OAuth prompt; token present in the token prompt; ChatGPT marked OAuth-only in the token prompt | Unit, `apps/web/test/agent-setup-prompt.test.ts` |
| The dismissal rule: same id hides, other id shows, throwing storage shows | Unit, same file |
| The copy button: copied, back to idle, refused, no clipboard | Unit, `packages/ui/test/copy-button.test.tsx` |
| Pill copy, close, reload, sign out and in; token page OAuth copy, minted agent token copy, no prompt for a REST token | End to end, `e2e/s01c-agent-setup-prompt.spec.ts` |
| S-01 and the token page in the axe scan | Already covered by `e2e/s43-accessibility.spec.ts` |

## 8. What this change does not do

- No brand logos. Generic icons until the product owner decides on marks.
- No per-agent deep links or one-click installers.
- No server-side record of the dismissal.
- No change to the agent endpoint, the token model or the OAuth flow.
