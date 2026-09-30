---
"openokr": minor
---

A local AI agent can connect with a token, every public door is rate limited,
and a token can no longer administer tokens.

An agent that cannot open a browser, such as a coding agent in a terminal or a
desktop assistant set up from a file, had no way to reach the agent endpoint:
it only accepted tokens from the browser consent flow. On **Account, then API
tokens**, a token can now be made for **An AI agent**. It is shown once, already
inside a configuration the agent can read, and the agent sends it as a bearer
token to `/api/mcp`. It carries your own access narrowed by the scopes you
choose, exactly like an agent you approve in the browser, and it works at the
agent endpoint and nowhere else. A REST token is refused there and told which
kind to make. The tokens list now says which kind each token is.

The agent endpoint, OAuth client registration, the OAuth token endpoint and
SCIM directory sync are now rate limited, as the REST surface already was. A
refusal is a 429 with `Retry-After`, in each protocol's own error shape. The
REST surface and the device login now send `Retry-After` too.

| Door | Counted per | Limit |
|---|---|---|
| `/api/mcp` | Approved agent, or agent token | 600 a minute |
| `/api/mcp/register` | Caller address | 10 a minute |
| `/api/mcp/token` | Caller address | 600 a minute |
| `/api/scim/v2` | Directory token | 600 a minute |

The caller address is the one the sign-in lockout already counts: a single
address in `X-Forwarded-For` or `X-Real-IP`, as the shipped proxy writes it.
The device login used to trust the first entry of a forwarded chain, which the
caller can write, and now does not.

**Behaviour change.** Minting a token, revoking one and approving a terminal
now work only in the browser, signed in. A call to `tokens.create`,
`tokens.revoke` or `tokens.approveDevice` through the REST surface, the agent
endpoint or chat is refused, whatever the token's scopes. Before this, a token
with write scope could mint itself one with destructive scope.
