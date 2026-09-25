# A staging instance for acceptance testing

How to deploy the instance the [acceptance test workbook](../testing/OpenOKR-UAT.xlsx)
runs on, with the persona seeder. It is the ordinary
[one-server install](compose.md) plus two things: a small Compose overlay, and
one command that creates the seven test accounts after the setup wizard.

Budget about an hour the first time, most of it the image build. Every step
below was run end to end on Docker on 25 September 2026: build, start with the
overlay, both wizards in a browser, the seeder, a second seeder run, a persona
signing in, and a new round from nothing.

## What the seeder does, and what it does not

The workbook starts from an empty database and has the testers build the
organisation through the screens. The one part worth skipping is creating
seven accounts by invitation, so the seeder does exactly that and nothing else.

| The seeder creates | The testers still build, through the UI |
|---|---|
| Seven accounts: Priya, Daniel, Tomás, Mei, Sara, Jonas, Amara | The first account and the welcome wizard (modules M01, M02) |
| Each one a member with edit access, joined through a real workspace invitation that is revoked afterwards | Titles and managers (M06) |
| Addresses as plus-addresses on one inbox, `qa+priya@example.com` and so on | Spaces (M07), goals, KPIs, sessions and everything after |

The full demo seed (`pnpm db:seed`) is **not** used here. It fills in the
objectives, KPIs and sessions the workbook exists to test, and a tester who
finds them already there tests nothing.

## Before you start

| You need | Why |
|---|---|
| A Linux host with Docker Engine and Docker Compose v2 | The instance runs as containers. Docker Desktop on macOS or Windows works for a local rehearsal |
| 2 CPU cores, 4 GB of memory, 20 GB of disk | The image build is the heaviest step |
| Git, Node 22 and pnpm 11 on the host | The seeder runs from a checkout on the host, not from inside the image. Running `corepack enable` once installs the exact release `package.json` asks for |
| Ports 80 and 443 free, or two others you choose | The bundled proxy answers on them |
| A DNS name pointing at the host, for HTTPS | Optional. Without one the instance serves plain HTTP |
| One mailbox that accepts plus-addresses | Gmail, Google Workspace and Microsoft 365 all do. Every persona's mail lands there |
| An SMTP server, or Mailpit | Optional, but without it password resets (module M05) only reach the application log |

**The checkout and the image must be the same version.** The seeder is code
from the checkout talking to the database the image migrated. Build the image
from the checkout you seed from, as below, and they cannot disagree.

## 1. Get the code and build the image

```sh
git clone https://github.com/open-okr/open-okr.git
cd open-okr
git checkout <the branch or tag under test>

corepack enable
pnpm install

docker build -f deploy/docker/Dockerfile -t openokr:staging .
```

## 2. Configure mail (optional, before the first start)

Skip this and every mail is written to the application log instead, which is
enough for everything except module M05.

The first start creates `deploy/docker/secrets/app.env`. To add mail later,
append these to that file and run step 3 again. `./openokr` keeps what you
add; the only line it rewrites is `BETTER_AUTH_URL`.

```sh
OPENOKR_MAIL_TRANSPORT=smtp
OPENOKR_MAIL_HOST=smtp.example.com
OPENOKR_MAIL_PORT=587
OPENOKR_MAIL_SECURE=false
OPENOKR_MAIL_USER=...
OPENOKR_MAIL_PASSWORD=...
OPENOKR_MAIL_FROM=openokr@example.com
```

For a host with no mail server, run Mailpit and point the instance at it:
`OPENOKR_MAIL_HOST` is the host's address as the container sees it,
`OPENOKR_MAIL_PORT=1025`, and the mail is readable on port 8025.

## 3. Start the stack with the staging overlay

```sh
cd deploy/docker
export OPENOKR_IMAGE=openokr:staging
export COMPOSE_FILE="compose.yaml:../staging/compose.staging.yaml"
OPENOKR_DOMAIN=staging.example.com ./openokr up
```

Leave out `OPENOKR_DOMAIN` to serve plain HTTP on `http://localhost`. Set
`OPENOKR_HTTP_PORT` and `OPENOKR_HTTPS_PORT` if 80 and 443 are taken.

**On Docker Desktop for Windows**, also `export COMPOSE_PATH_SEPARATOR=:`.
Compose splits `COMPOSE_FILE` on `;` there, and reads the value above as one
file name that does not exist.

**A host that already runs another OpenOKR stack**, a normal install or the
demo, needs its own project name and ports, so the two keep separate
containers, volumes and secrets. Run the staging stack from its own checkout
and add `export COMPOSE_PROJECT_NAME=openokr-staging`.

The overlay, [`deploy/staging/compose.staging.yaml`](../../deploy/staging/compose.staging.yaml),
changes one thing: it publishes PostgreSQL on `127.0.0.1:55434`, the loopback
address only, so the seeder on the host can reach it. Nobody off the host can.
`OPENOKR_STAGING_DB_PORT` moves it.

**Keep both exports for every later `./openokr` command on this host**, `up`,
`down`, `logs` and `upgrade` included. Without `COMPOSE_FILE` the next restart
drops the overlay and the seeder can no longer reach the database.

`./openokr up` prints the address when the instance is healthy.

## 4. Run modules M01 and M02 in the browser

This is the first part of the test, not a setup chore. A tester opens the
address, creates the first account in the setup wizard, and walks the welcome
wizard, choosing the **OKR starter cycle** template. Record the results in the
workbook as they go.

The seeder refuses to run before this: until the wizard has created a
workspace there is nothing to add people to.

## 5. Seed the personas

From the root of the checkout:

```sh
cd ../..
sh deploy/staging/seed.sh --inbox qa@example.com
```

Use the plain inbox, with no `+` in it. The output looks like this:

```
Adding the UAT personas to "Northwind Labs".
7 persona(s) joined through a workspace invitation.

Sign in as any of these:
  qa+priya@example.com                 Priya Raman
  qa+daniel@example.com                Daniel Osei
  ...

Password: northwind-uat-2026
```

`--password <at least 12 characters>` sets a different shared password.
Running the script again changes nothing and says who is already a member.

This is workbook case **M02-04**. Case M02-05 then signs in as Priya to prove
an account works.

## 6. Hand over to the testers

Give them:

| What | Where it goes |
|---|---|
| The instance address | Read Me sheet, step 1 |
| The inbox you passed to `--inbox` | Personas sheet, the yellow "Shared inbox" cell. The seven addresses fill themselves in and match what the seeder created |
| The password | Personas sheet, "Shared password". Already filled with the default |
| The first account's address and password | Kept by whoever ran M01. It is the only account with full access |

## Starting a new test round

A round that needs a clean database starts again from nothing:

```sh
cd deploy/docker
./openokr destroy        # asks you to type DELETE; removes every volume
rm -rf secrets           # otherwise the old database password is reused
./openokr up
```

Then repeat from step 4. Deleting `secrets` matters: PostgreSQL sets its
password only when it initialises an empty volume, and new secrets with an old
volume, or the reverse, give an instance that cannot sign in to its own
database.

## What the seed script refuses, and why

| Message | Cause | Fix |
|---|---|---|
| This checkout has a .env | The command would read that file's `DATABASE_URL` and write to a different database | Move `.env` out of the checkout on the staging host |
| No secrets in ... | The stack has never been started from this checkout | Run step 3 first |
| No workspace found | The setup wizard has not been finished | Run step 4 first |
| This workspace already has N other member(s) | Somebody is using this workspace. Seven accounts sharing a known password do not belong in it | Use a fresh instance. See "Starting a new test round" |
| ... already has a plus in it | Each persona adds its own `+name` | Pass the plain inbox |
| `ECONNREFUSED 127.0.0.1:55434` | The stack was started without the overlay | Repeat step 3 with `COMPOSE_FILE` exported |

And from `./openokr up`:

| Message | Cause | Fix |
|---|---|---|
| Bind for 0.0.0.0:80 failed: port is already allocated | Something else on the host holds the port | Set `OPENOKR_HTTP_PORT` and `OPENOKR_HTTPS_PORT` to free ports |
| there is an existing database volume but no ./secrets/app.env | `secrets` was deleted while the volume was kept | Restore `secrets` from a backup, or start a new round as above |
| COMPOSE_FILE ... is invalid | Windows, without `COMPOSE_PATH_SEPARATOR=:` | Export it and run again |

## Security

- **The persona password is written in this repository and in the workbook.**
  That is acceptable on a staging instance with no real data, and it is the
  reason the seeder refuses a workspace that has anybody else in it. Pass
  `--password` if the staging address is reachable from the internet.
- **PostgreSQL is published on the loopback address only.** Do not change the
  overlay to `0.0.0.0`.
- **The demo overlay is not used.** `deploy/demo/compose.demo.yaml` turns on
  `OPENOKR_DEMO`, which lists the personas and their password on the sign-in
  page for anyone who opens it. A staging instance does not need that.
- **Never run the seeder against a production instance.** It will refuse one
  that has people in it, but a production instance that has only just been
  claimed has nobody in it yet.
