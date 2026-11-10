# The standard input and output transport for local agents

Status: approved 10 November 2026 and built in 0.7.0 (plan A1). It is a way in for an agent, so it was designed first (security).

Authority: AI-NATIVE-PLAN §8.1 ("standard input and output for local or air-gapped desktop agents"); `agent-surface.md` §5.1, whose correction at completeness review M-12 says the transport "is still owed, for a desktop agent that speaks only that".

## 0. What exists

| Piece | Where | Today |
|---|---|---|
| The agent endpoint | `apps/web/app/api/mcp/route.ts`, `packages/core/src/api/mcp/dispatch.ts` | Streamable HTTP. Accepts an OAuth access token or an agent API token (audience `mcp`), checked on every request: revocation, expiry, membership, suspension. Rate limited, scope-checked, every call recorded (A2) |
| Agent tokens | `/account/api-tokens`, audience `mcp` | Minted by the member, listed and ended by an administrator (A4) |
| The command line | `packages/cli`, `okr` | Reads `contract/cli.json`, calls REST with a stored profile's token. No runtime dependency |

So every check an agent meets already lives behind the HTTP endpoint. What is missing is only a process a desktop agent can start and talk to over its own standard input and output.

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| T1 | **A bridge, not a second server.** `okr mcp` reads JSON-RPC messages from standard input, sends each to the instance's `/api/mcp` with the profile's agent token, and writes the answer to standard output | Every authorisation, scope, rate limit, record and refusal stays on the server, in one place. A second implementation of the protocol beside the first would be a second door with its own mistakes |
| T2 | **Only an agent token.** `okr mcp` uses a token minted for the `mcp` audience, stored in the profile as `mcpToken` by `okr login --mcp-token <token>`. It never uses the profile's REST token, and the server refuses a REST token at `/api/mcp` anyway | Two audiences stay separate (TECHNICAL-PLAN §14). An administrator who ends the token on Agent connections ends the bridge too, with nothing else to find |
| T3 | **Nothing new is stored on the desktop beyond the token**, in the profile file the command line already keeps, readable only by its owner. The bridge logs nothing of the messages it carries | The token is the only secret. Message bodies can hold workspace content, so they never reach a log |
| T4 | **One message at a time, in order**, as JSON-RPC over standard input and output requires. A message the server answers with an error is passed through unchanged. A network failure answers the JSON-RPC request with an error saying the instance could not be reached | The desktop agent sees one protocol and real errors |
| T5 | **No new dependency.** The platform `fetch` and line-delimited JSON, as the command line already does | `packages/cli` has none, and keeps none |
| T6 | **Air-gapped is the point.** The bridge talks only to the instance the profile names, which on an air-gapped install is on the same network | Nothing reaches the internet |

## 2. Acceptance criteria

- Given a profile with an agent token, when a desktop agent starts `okr mcp` and sends `initialize` then `tools/list`, then it receives the instance's answers, the same as over HTTP.
- Given the token is ended on Agent connections, when the next message is sent, then it answers with the server's refusal and no tool runs.
- Given a profile with only a REST token, when `okr mcp` starts, then it exits with a message saying to add an agent token with `okr login --mcp-token`.
- Given the instance is unreachable, when a request is sent, then the agent receives a JSON-RPC error naming the instance address, and the bridge keeps running.
- Given any run, then nothing of the messages is written to a log or a file.

## 3. Tests

| Kind | File | Covers |
|---|---|---|
| Unit | `packages/cli/test/mcp-bridge.test.ts` | Line framing, pass-through, the missing token, the network error, no logging |
| Browser | `e2e/s41b-mcp-stdio.spec.ts` | The bridge as its own process against a running instance, with an agent token minted on the tokens screen: initialize, then tools/list. Chosen over a core integration test, because `packages/cli` imports nothing from core and the endpoint's own refusals are tested where they are made |

## 4. Question for Akmal

None: the design adds no authority and no secret beyond the agent token the product already mints.

## 5. As built

| Piece | Where |
|---|---|
| The bridge | `packages/cli/src/mcp-bridge.ts`, `runMcpBridge`: one POST per line, the session and protocol version the server gives sent back, an event-stream answer read as well as JSON |
| The command | `okr mcp [--profile name]` in `packages/cli/src/run.ts`; it refuses a profile with no agent token before reading anything |
| Storing the token | `okr login --url <instance> --mcp-token <token>` keeps it as `mcpToken` beside the profile's REST token |
