# Running OpenOKR with no route to the internet

For an instance on an isolated network: no outbound route, no proxy, no
registry, no CDN. Everything the product needs is in the image and the
database.

This is not a special build. The same release runs air-gapped and connected;
what changes is that the optional connections stay unconfigured, and the
product is whole without them because continuous integration proves it is.

## What works with no network at all

| Works | Why |
|---|---|
| Sign-in with a password, a passkey or a one-time code | Every factor is computed locally. A passkey is bound to the instance origin, not to a service |
| The whole OKR practice | `packages/method` is pure and ships in the image |
| Scoring, health, alignment, cadence, the sessions, the diagnostic | Deterministic, and the same code in the browser and on the server |
| Both agents: the Coach and the Champion | Every nudge, escalation, gate and diagnostic is deterministic. AI adds drafting and rewriting, never the decision |
| Import from a spreadsheet | The file is uploaded to the instance |
| Export, the workspace archive, the audit export | Built by the instance and handed to the browser |
| Upgrades | `docker compose pull` from a registry mirror, or a loaded image tarball |

## What needs a connection, and stays off until it has one

Each of these is an instance connection with no default. An instance that never
configures one never calls out.

| Connection | Off means |
|---|---|
| AI provider | Every AI affordance is hidden or disabled. `ai_providers.enabled` defaults to false, and no provider is seeded |
| Mail | The console transport. A reset link is printed for an operator rather than sent, and email verification is not required to sign in |
| Chat channels | No Slack, Teams, WhatsApp or Telegram. Nudges arrive in the product |
| Single sign-on | Password and passkey sign-in, which is the default anyway |
| Directory sync | Members are invited rather than provisioned |
| Link enrichment and the agent's research tools | Absent. `outboundFetch` is the only way out and it is never called with nothing configured |

**A local AI provider counts as no route out.** An OpenAI-compatible server on
the same isolated network is configured as a base URL like any other provider,
and `outboundFetch` resolves and checks the address before it connects. The
air-gap and the AI layer are not exclusive; what is excluded is the public
internet.

## Installing

1. On a connected machine, pull the release image and save it:
   `docker save ghcr.io/open-okr/open-okr:<tag> -o openokr-<tag>.tar`
2. Carry the tarball and `deploy/docker/` across.
3. On the isolated machine: `docker load -i openokr-<tag>.tar`
4. `sh deploy/docker/openokr up`, which generates every secret on first run.
5. Open the instance and complete the setup wizard. It asks for nothing that
   needs a network.

Postgres is the only required service, and the compose file brings its own.

## The checklist

Each row is checked by `pnpm check:air-gap`, which runs in continuous
integration. The identifiers are what tie this table to that script: a row
here with no check, or a check with no row here, fails the gate. The point is
that this page cannot quietly stop being true.

| Check | What it proves |
|---|---|
| `fonts-self-hosted` | The typeface is committed and served by the instance, so no page load reaches a font service |
| `no-external-hosts` | No shipped source names a CDN or a font service to fetch from at runtime |
| `no-runtime-network-install` | The image's runtime stage installs nothing from a network, so a container starts with no registry |
| `ai-off-by-default` | No AI provider is enabled until somebody enables one, so an instance nobody configured makes no AI call |
| `outbound-goes-through-the-port` | Every outbound request goes through `outboundFetch`, which validates the literal host and the resolved address, follows no redirect, and caps size and time |
| `registries-are-build-time` | Interface components are added into `packages/ui` at build time, so no component is fetched when a page renders |

## Validating on the isolated machine

The checks above are about the source and run anywhere. These two are about
the machine and can only be done there.

1. **Watch for egress.** With the instance running and somebody using it,
   `tcpdump -n -i any 'not host <db> and (port 80 or port 443)'` should stay
   silent. Do this for a session that includes a sign-in, a check-in, a nudge
   and an export.
2. **Prove it is not cached.** Restart the container and repeat. A page that
   only works the second time is a page that fetched something the first.

Record both in the instance's own commissioning notes. Neither can be automated
from this repository, because this repository is not on that network.

## Related

- `docs/runbooks/upgrade.md` for the upgrade path, which is the same one with a
  loaded tarball instead of a pull.
- `docs/runbooks/restore.md` and `docs/runbooks/incident.md`.
