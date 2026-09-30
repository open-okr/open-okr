# The API

Everything a person can do, a program can do, on the same terms.

There is one action registry. The browser, the REST surface, the command line,
the agent tool catalogue and the chat commands are all projections of it, so a
capability that exists in one exists in all of them at the same access level.
There is no second permission model and no administrative back door.

| Page | What it holds |
|---|---|
| [Reference](reference.md) | Every action, generated from the contract |
| `/api/v1/openapi.json` | The same document, served live by your instance |

## Authenticating

A bearer token on every request.

```sh
curl -H "Authorization: Bearer $OPENOKR_TOKEN" \
  https://okr.example.com/api/v1/goals/list
```

Make one under **Account, then API tokens**. A token is shown once, hashed at
rest, scoped, and it records when it was last used.

| Token property | Detail |
|---|---|
| Audience | **REST** for `/api/v1`, or **AI agent** for the agent endpoint. Each is refused at the other's door |
| Scopes | `read` and `write`. Destructive actions are never granted by default |
| Expiry | Set when you create it |
| Revocation | Immediate. The next request fails |
| Membership | Revalidated on every request. Suspending the member kills the token |

**A token-authenticated caller cannot administer tokens.** Minting, revoking
and approving a terminal are refused to anything that arrived with a token, an
agent's grant or a chat link, whatever its scopes. That closes the loop where a
leaked token mints itself a better one. Make and revoke tokens on the tokens
screen, signed in.

## From a terminal

The command line is generated from the same contract, so it needs no domain
code of its own.

```sh
pnpm okr login --url https://okr.example.com
pnpm okr goals list --help
```

`login` runs a device flow: it prints a link, somebody approves it at
`/account/device`, and the granted token lands in the profile. `--token` stores
one you already made instead.

Exit 2 is a usage error decided before anything is sent. Exit 1 is the instance
refusing.

## From an AI agent

Your own Claude, ChatGPT or Cursor connects to the agent endpoint and gets the
same catalogue, through a consent screen that names what it will be able to do.
It acts as you, within your permissions, and every call is audited.

Each tool carries its safety class, so a read-scoped agent calling a write tool
is refused with the scope it needed rather than a generic error, and nothing is
written.

### An agent that cannot open a browser

A coding agent in a terminal, or a desktop assistant set up from a file, has no
browser to send you to a consent screen. Give it an **agent token** instead.

1. Go to **Account, then API tokens**.
2. Under **What it is for**, choose **An AI agent**. Pick the scopes it needs.
   Read is enough for an agent that only reports.
3. Create the token. It is shown once, already inside a configuration you can
   paste.

The agent sends the token as a bearer token to the agent endpoint,
`https://okr.example.com/api/mcp`. Most agents read a configuration like this:

```json
{
  "mcpServers": {
    "openokr": {
      "type": "http",
      "url": "https://okr.example.com/api/mcp",
      "headers": { "Authorization": "Bearer okr_mcp_..." }
    }
  }
}
```

| | An agent you approve in the browser | An agent token |
|---|---|---|
| Who starts it | The agent, which sends you to a consent screen | You, on the tokens screen |
| Scopes | What you approved | What you chose when you made it |
| Lifetime | Until you revoke it, on access tokens that last an hour and refresh | Until it expires or you revoke it |
| Where you see it | **Account, then Connected agents** | **Account, then API tokens**, with when it was last used |
| Permissions | Yours, narrowed by its scopes | The same |

**An agent token opens the agent endpoint and nothing else.** A REST token is
refused there, and an agent token is refused at `/api/v1`. The endpoint does
not assign a session to an agent-token connection; the protocol allows that,
and every request is checked from scratch either way.

## Rate limits

Every door a program uses is limited, and a refusal says when to try again.

| Door | Counted per | Limit | Refusal |
|---|---|---|---|
| `/api/v1` | Token | 600 a minute | 429, `Retry-After`, `error.code` of `rate_limited` |
| `/api/mcp` | Approved agent, or agent token | 600 a minute | 429, `Retry-After`, a JSON-RPC error answering the request's id |
| `/api/mcp/register` | Caller address | 10 a minute | 429, `Retry-After`, OAuth error `temporarily_unavailable` |
| `/api/mcp/token` | Caller address | 600 a minute | 429, `Retry-After`, OAuth error `temporarily_unavailable` |
| `/api/v1/cli/device` | Caller address | 10 a minute | 429, `Retry-After`, `error.code` of `rate_limited` |
| `/api/scim/v2` | Directory token | 600 a minute | 429, `Retry-After`, the SCIM error schema |

The limits are fixed rather than settings: they bound abuse of a public door,
and nobody should have to configure one to be protected.

**The caller address is the one the sign-in lockout counts.** It is read from
`X-Forwarded-For`, then `X-Real-IP`, and only when the header holds exactly one
address. The shipped reverse proxy replaces `X-Forwarded-For` with the address
it saw, so that is what it holds. A proxy that appends to the header instead
leaves a chain whose first entry the caller wrote, so a chain is not trusted,
and every caller the instance cannot place shares one count. If your own proxy
appends, configure it to replace the header.

## Answers and errors

Every answer is an object with the action's own output under `data`.

A refusal names what happened rather than leaving the caller to guess:

| Status | Means |
|---|---|
| 400 | The input did not validate. The answer names the field |
| 401 | No token, or a token that is expired or revoked |
| 403 | Authenticated, and not allowed to do this |
| 404 | No such thing, **or** something you may not see. The two are deliberately the same answer |
| 409 | A rule refused, and the message says which |
| 429 | Rate limited |

**404 covering both "gone" and "forbidden" is deliberate.** A distinct 403 on a
protected resource tells an unauthorised caller that the resource exists, which
is itself a leak.

## Versioning

The surface is under `/api/v1`. Actions are added without a version bump.
Removing or renaming one spans two releases: the first adds the replacement and
serves both, the second removes the old.

Continuous integration compares the generated contract against the committed
one, so the document and the code cannot drift.

## Next

- [Reference](reference.md)
- [Administrator guide](../admin/README.md)
