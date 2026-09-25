---
"openokr": patch
---

`pnpm uat:personas --inbox <address>` gives a fresh workspace the seven
Northwind people as members who can sign in, for the manual acceptance test.

Each persona joins through a workspace invitation the founder issues, the same
path somebody clicking an invitation link takes, and the link is revoked when
the run ends. Their addresses are plus-addresses on the one inbox given, so a
password reset reaches a mailbox a tester can read. Titles, managers, spaces
and goals are left empty, because those are what the test builds by hand.

The command refuses a workspace that has anybody in it besides its founder and
these seven, and a second run changes nothing. `deploy/staging/seed.sh` runs it
against a Docker Compose stack started with the new `compose.staging.yaml`
overlay, which publishes Postgres on the loopback address only.

`./openokr up` no longer refuses a second stack on the same host. Its check
for "a database volume but no secrets" looked for the default project's
volume whatever `COMPOSE_PROJECT_NAME` said, so a demo or staging stack beside
a normal install was refused over a volume that belonged to the other one.
