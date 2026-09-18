# Running a public demonstration instance

A demo instance is the product, with three differences: the workspace is
seeded, the people in it can be signed in as by anybody, and the whole thing is
destroyed and rebuilt on a schedule.

Nothing is switched off to make that work. No gate is loosened, no rule is
relaxed, and no feature is hidden. A demo that ran a different product would be
worth nothing.

## What a visitor sees

They arrive at the sign-in page, which names seven people and publishes the one
password they share. They pick one, and they are that person: their goals,
their check-ins, their review inbox, their nudges.

The workspace holds a quarter in flight and a quarter that is finished. The
finished one has a scorecard row and a closing diagnostic. Both agents are
running in sandbox, so their nudges and proposals are real and nothing they
suggest is ever committed.

## What you need

- A host with Docker and Docker Compose
- A checkout of this repository on that host, with `pnpm` available
- A DNS name pointing at the host, if you want certificates

The checkout is not optional. The seed and the persona command run from it,
because they need the full workspace package graph and the runtime image
deliberately ships only what the application and the migrator need.

## Running it

```
git clone https://github.com/open-okr/open-okr /srv/open-okr
cd /srv/open-okr
OPENOKR_DOMAIN=demo.example.com sh deploy/demo/reset.sh
```

The script tears down the `openokr-demo` compose project including its volumes,
starts it again with fresh secrets, waits for health, creates the operator
account, seeds the organisation and gives the cast their accounts.

It takes a few minutes, most of it the seed.

## Resetting it on a schedule

The reset is the same script. Run it from cron on the host:

```
0 3 * * *  cd /srv/open-okr && sh deploy/demo/reset.sh >> /var/log/openokr-demo-reset.log 2>&1
```

**It destroys everything every time, and that is the design.** An instance
strangers can write to accumulates whatever they wrote. A reset that deleted
only what visitors added would be a delete path across 129 tables that nobody
exercises, and the one failure mode it cannot avoid is leaving half of
something behind. Starting from an empty volume cannot.

The compose project name is fixed in the script rather than read from the
environment, so it cannot be pointed at another stack by setting a variable.

## The settings that make it a demo

| Setting | Value | What it does |
|---|---|---|
| `OPENOKR_DEMO` | `on` | The sign-in page names the personas and publishes their password. Nothing else in the product reads it |
| `OPENOKR_DEMO_HTTP_PORT` | `80` | The port Caddy publishes |
| `OPENOKR_DEMO_DB_PORT` | `55433` | Postgres on the loopback address, so the seed can reach it from the host. Not reachable from anywhere else |
| `OPENOKR_DEMO_OWNER_EMAIL` | `demo-owner@northwind.example` | The account that claims the instance |
| `OPENOKR_DEMO_OWNER_PASSWORD` | `demo-operator-passphrase` | Its password. Separate from the visitors', so the two are not one credential |

`OPENOKR_DEMO` defaults to `off`. An instance nobody configured says nothing
about personas, which is the right answer for every instance that is not a
demonstration.

## The passwords are published, and they are not secrets

The persona password is `explore-openokr` and it is printed by
`pnpm demo:prepare`, written here, and shown on the sign-in page. An account
nobody can sign into is not a demo account.

Every account it names lives inside an instance that is wiped on a schedule and
holds nothing real. Do not run `OPENOKR_DEMO=on` on an instance that holds
anybody's actual work.

## Doing it by hand

The reset script is three steps you can run yourself.

```
cd deploy/docker
COMPOSE_PROJECT_NAME=openokr-demo \
COMPOSE_FILE=compose.yaml:../demo/compose.demo.yaml \
  ./openokr up
```

Then register the first account at the instance's address, and from the
repository root, with `DATABASE_URL` pointing at the container's Postgres:

```
pnpm db:seed
pnpm demo:prepare
```

`pnpm db:seed` writes the organisation. `pnpm demo:prepare` gives the cast
accounts, puts both agents in sandbox, and runs the Coach and the Champion once
so the nudges on screen are ones the product produced.

`pnpm demo:prepare` refuses a workspace the demo builder did not build, and
never touches a member who already has a real person behind them.

## Related

- [One server with Docker Compose](compose.md), which this builds on
- [The first run](first-run.md)
- [Operations](../admin/operations.md)
