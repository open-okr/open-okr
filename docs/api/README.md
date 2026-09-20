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
| Scopes | `read` and `write`. Destructive actions are never granted by default |
| Expiry | Set when you create it |
| Revocation | Immediate. The next request fails |
| Membership | Revalidated on every request. Suspending the member kills the token |

**A token-authenticated caller cannot administer tokens.** That closes the loop
where a leaked token mints itself a better one.

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
