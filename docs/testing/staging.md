# The UAT staging instance

How to stand up the instance the [acceptance test workbook](OpenOKR-UAT.xlsx)
runs on. The workbook starts from an empty database and has the tester build
everything through the screens, except the seven persona accounts, which a
command creates after the setup wizard.

## What gets seeded, and what does not

| Created by the command | Left for the tester |
|---|---|
| Seven accounts: Priya, Daniel, Tomás, Mei, Sara, Jonas, Amara | The first account and the setup wizard (M01, M02) |
| Each one a member with edit access, joined through a real invitation | Titles and managers (M06) |
| One workspace invitation, revoked when the run ends | Spaces (M07), goals, KPIs, sessions and everything after |

The full Northwind demo (`pnpm db:seed`) is deliberately not used here. It
fills in the objectives, KPIs and sessions the workbook exists to test.

## Steps, on the staging host

You need a checkout of this repository, Node 22, pnpm and Docker.

**1. Start the stack with the staging overlay.** The overlay publishes
Postgres on `127.0.0.1:55434` so the command can reach it from the host. It is
not reachable from anywhere else. Set `OPENOKR_STAGING_DB_PORT` to move it.

```sh
cd deploy/docker
COMPOSE_FILE="compose.yaml:../staging/compose.staging.yaml" ./openokr up
```

**2. Run M01 and M02 in the browser.** Create the first account and finish the
welcome wizard. The command refuses to run before a workspace exists.

**3. Create the personas.** From the root of the checkout:

```sh
pnpm install
sh deploy/staging/seed.sh --inbox qa@example.com
```

It prints the seven addresses (`qa+priya@example.com` and so on) and the
password. `--password <12 or more characters>` sets a different one; the
default is `northwind-uat-2026`. Type the same inbox into the Personas sheet
and the workbook shows the same addresses.

## What the script refuses

| Refusal | Why |
|---|---|
| A checkout with a `.env` file | The command would read that file's `DATABASE_URL` and write to a different database |
| No secrets in `deploy/docker/secrets` | The stack has never been started from this checkout |
| No workspace yet | The setup wizard has not been finished |
| A workspace with other people in it | Somebody is using it. Seven accounts with a shared password do not belong there |
| An inbox with a `+` already in it | Each persona adds its own `+name` |

Running it twice changes nothing: people who are already members are listed as
such and no second invitation is issued.

## Mail

The persona addresses only help if mail leaves the instance. Without it every
message, a password reset included, is written to the application log instead.
Before M05, add these to `deploy/docker/secrets/app.env` and run
`./openokr up` again. The file keeps what you add; `./openokr` only rewrites
`BETTER_AUTH_URL` in it.

```sh
OPENOKR_MAIL_TRANSPORT=smtp
OPENOKR_MAIL_HOST=smtp.example.com
OPENOKR_MAIL_PORT=587
OPENOKR_MAIL_SECURE=false
OPENOKR_MAIL_USER=...
OPENOKR_MAIL_PASSWORD=...
OPENOKR_MAIL_FROM=openokr@example.com
```

For a staging host with no mail server, Mailpit catches everything: run it on
the host, set `OPENOKR_MAIL_HOST` to the host's address as the container sees
it and `OPENOKR_MAIL_PORT=1025`, and read the mail at port 8025.
