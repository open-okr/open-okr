# Agent connections, seen by an administrator

Status: proposed 9 November 2026 for release 0.7.0 (plan A4), waiting for "design approved". An administrator would see and end other members' grants, which is a change to access, so it is designed first (CLAUDE.md).

AI-NATIVE-PLAN §4 puts a "Connections" card in the AI console: "MCP clients and grants with last-used and audit links, revoke". UIUX-PLAN S-37 lists it. Today each member sees only their own, on purpose, and the reason is written down.

## 0. What exists

| Piece | Where | Today |
|---|---|---|
| A member's own list | `packages/core/src/actions/oauth-connections.ts:42-100` | `connections.mine`, at view. Reads the acting member's grants only and takes no member id. The file header (`:3-7`) and the page (`apps/web/app/account/connections/page.tsx:22-24`) both say why: "an action that accepted one would be an action somebody could aim at a colleague" |
| A member's own revoke | `oauth-connections.ts:102-164` | `connections.revoke`, at edit, destructive. Loads the grant scoped to the actor's member id, so another member's grant is not-found. Revokes the grant, its access tokens and its refresh tokens through `revokeGrant` (`packages/core/src/api/oauth/grants.ts:76`). Activity `connection.revoked`, which is on the workspace feed (not in `PRIVATE_ACTIVITY_KINDS`, `activities/catalogue.ts:752`) |
| Why a grant was revoked | `grants.ts:26-31`; `packages/db/migrations/0062_oauth.sql:72` | `member`, `reuse` and `membership`, each with a sentence the member reads. `revoked_reason` is plain text with no check, so a new key needs no migration |
| The tables | `packages/db/src/schema/oauth.ts:23-75` | `oauth_clients` belongs to the instance, never to a workspace. `oauth_grants` has `workspace_id`, `member_id`, `client_id`, `scopes`, `revoked_at`, `revoked_reason`, `last_used_at`, under the tenant policy, indexed on `(workspace_id, member_id)` |
| What an administrator can already do | `packages/core/src/actions/people.ts:402-406`; `api/oauth/resolve.ts:116-121`; `api/oauth/flow.ts:320-331` | `people.suspend`, at `full`. Membership is checked on every agent request, and a refresh by a member who is gone revokes the grant with `membership`. So `full` already ends every connection a colleague holds |
| Who reaches admin | `apps/web/app/admin/layout.tsx:52`; `apps/web/app/admin/ai/page.tsx:132-137`; `packages/core/src/access/permissions.ts:14-17` | `full` on the workspace context for every admin screen, including the AI console. `manage_ai` is declared as a string and resolves to that level today |
| Keeping an action from agents and tokens | `packages/core/src/actions/define.ts:205-210`; `actions/api-tokens.ts:57-64`, `:242-256` | `agentSurface: false` keeps an action out of the tool catalogue. `refuseUnlessSignedIn` refuses any call that arrived with a token, a grant or a chat link. `tokens.revoke` uses both |
| Audit filtered to a person | `apps/web/app/admin/audit/audit-panel.tsx:47`; `packages/core/src/api/mcp/dispatch.ts:145` | `/admin/audit?actorMemberId=...` already works. An agent's writes carry `channel: mcp` in their audit payload. Nothing records which grant made a call (that is plan A2) |

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Two new registry actions, beside the two that exist.** `connections.list` (read) and `connections.revokeAsAdmin` (write, destructive). `connections.mine` and `connections.revoke` are not changed and still take no member id | The member's own actions keep the property their comments promise. The power to reach a colleague's grant lives only in actions that ask for the level that already has it |
| D2 | **Both require `full` on the workspace context**, declared as the action's `access`, so the pipeline's floor and `can()` decide. No new permission, no role domain | The level every admin screen and the AI console use. Whoever holds it can suspend the colleague, which ends every connection they have (§0). Ending one is strictly less |
| D3 | **Both are for a signed-in browser only.** `agentSurface: false`, and both call `refuseUnlessSignedIn`, so REST, the command line, the agent endpoint and chat are refused | A leaked token or an administrator's own agent must not be able to list who uses which agent, or switch a colleague's off. This is the misuse the existing comment worries about, closed at the door rather than in the interface |
| D4 | **Revoke takes a grant id, never a member id**, and loads the grant inside the Operation under the tenant floor. Missing, already revoked or in another workspace is not-found | The same shape as the member's own revoke. Nothing to aim except a row this workspace holds |
| D5 | **The same `revokeGrant`**, so the grant, its access tokens and its refresh tokens end together, with a new reason key `admin`: "An administrator of this workspace ended this connection." An administrator ending their own stores `member` as today | One revocation path. The member's own page then says why their agent stopped, without naming who (the audit row does) |
| D6 | **A private activity**, `connection.ended_by_admin` `{ grantId, memberId }`, added to `PRIVATE_ACTIVITY_KINDS` | It names a colleague and their tool. The workspace feed is the wrong place for that; the audit trail is the right one |
| D7 | **Audit**: action `connections.revokeAsAdmin`, target `oauth_grant` and its id, payload `{ memberId, clientName, scopes }`, actor the administrator, in the same transaction as the revoke | Who ended whose connection to what, answerable a year later |
| D8 | **Reading the list is not audited** | No admin read is, and the list holds nothing that can be presented anywhere. An audit row per page view would bury the ones that matter |
| D9 | **The screen is `/admin/connections`**, "Agent connections", in the admin navigation beside AI and Agents (`packages/core/src/modules/registry.ts`, `minLevel: full`). It is part of S-37 and shows with AI off | An external agent connects with no AI provider configured, so this is not an AI affordance and must not hide with one |
| D10 | **What a row shows**: the member's name and a chip when they are suspended; the client's display name (`clientDisplayName`) and whether it registered itself or the instance allows it; the scopes; connected on; last used on, to the day; the state (active, revoked with its sentence, or inactive because the member is no longer active); a link to the audit log filtered to that member; an End control that asks first. Live connections by default, with Ended and All as filters, newest first, 50 a page through the registry's page contract | What the specification asks for, at the granularity the member's own page already uses |
| D11 | **Never shown, and absent from the action's output schema**: access tokens, refresh tokens, authorisation codes, any hash, redirect addresses, the client's metadata address, the member's email, any network address, MCP session ids | None of it helps decide whether a connection should exist, and some of it could be presented somewhere |
| D12 | **Only clients with a grant in this workspace appear.** The instance's client list is never read here | `oauth_clients` spans every workspace on the instance. Listing it would tell one customer about another's tools |

**Q1, for you.** Should the member be told in their inbox when an administrator ends their connection? Without it they find out when their agent is refused, and their Connections page then says why. With it, a new notification reason is needed, `connection_ended`, which means a migration widening `notifications_reason_check` and `subscriptions_reason_check` the way support-access.md §10 does (whichever of the two lands second carries the other's values). The row would go to the one member, link to `/account/connections` and follow their routing like any reason; no nudge and no agent. **Proposed: yes.** A screen that can reach a colleague is only fair if the colleague hears about it.

**Q2, for you.** An agent can also connect with an API token whose audience is `mcp`, made at `/account/api-tokens`. Those are not grants and this design does not list them. **Proposed: list them in the same screen in a later change.** Ending one for somebody else needs a reason column `api_tokens` does not have, or its owner's page could not say why it stopped. Suspending the member still ends them today.

## 2. The screen

```
Agent connections                                    Admin → Agent connections
External agents members of this workspace connected. Ending one stops it at
its next request.                                    [Live] [Ended] [All]

Priya Raman     Claude Desktop · registered itself     read  write
                Connected 2 Nov · last used 9 Nov      Active
                Actions in the audit log →                         [End…]
```

End asks: "End Priya Raman's connection to Claude Desktop? It stops working at its next request, and Priya's Connections page will say an administrator ended it."

## 3. Acceptance criteria

- Given member B with a live connection, when administrator A opens `/admin/connections`, then B's row shows the client, scopes, connected and last-used dates, and neither the page nor `connections.list`'s output contains a token, a code or a hash.
- Given a member at `edit`, when they call `connections.list` or `connections.revokeAsAdmin`, then both are refused, and `/admin/connections` answers not-found.
- Given A holding an API token or an agent grant with destructive scope, when either action is called through it, then it is refused, and neither action appears in `contract/mcp.json`.
- Given A ends B's connection, then the grant and every access and refresh token in it are revoked, B's agent's next request is refused, B's `/account/connections` shows "An administrator of this workspace ended this connection.", one audit row names A, B and the client, and the workspace feed shows nothing new.
- Given a grant id from another workspace, when A ends it, then not-found and nothing changes.
- Given B, when B calls `connections.revoke` with A's grant id, then it is still not-found.
- Given AI is off, when A opens `/admin/connections`, then the screen works.
- Given A ends their own connection here, then its reason is `member`.

## 4. Tests

| Kind | File | Covers |
|---|---|---|
| Integration | `packages/core/test/connections-admin.test.ts` | The level, the surface refusals, the revoke and its tokens, the reason, the audit row, the private activity, another workspace's id |
| Integration | `packages/core/test/oauth-consent.test.ts` (existing) | `connections.mine` and `connections.revoke` unchanged |
| Contract | `pnpm check:contract` | Both actions in OpenAPI and the command line, neither in `contract/mcp.json` |
| End to end | `e2e/s37d-agent-connections.spec.ts` | An administrator ends a colleague's connection and the colleague's page shows why |

## 5. Documents changed in the same change

- AI-NATIVE-PLAN §4, the Connections row: who sees it, what it shows, and that it is browser only.
- UIUX-PLAN S-37 (the screen) and S-40 (a member's own page now has an administrator's view beside it).
- `agent-surface.md`, the connections list: the `admin` reason.
- The comments in `oauth-connections.ts` and `account/connections/page.tsx`: the member's actions still take no member id, and the administrator's view is separate, at `full`, browser only.
- `docs/admin/security.md`: a section on agent connections.
- `contract/` and `docs/api/reference.md` regenerated, the English and Malay message files, and a changeset.
- With Q1 yes: DATABASE.md §13 and §14, the reason values.
- TECHNICAL-PLAN §4.14 and §7.2: nothing. No setting and no table.

## 6. What this does not do

- It does not show what an agent read or did through a grant. Nothing records the grant on a call yet (plan A2); the audit link shows the member's own actions, with agent writes marked `mcp`.
- It does not let an administrator create, widen or narrow a colleague's grant.
- It does not list or end API tokens (Q2).
- It does not list the instance's registered clients, and it does not let a workspace block a client.
