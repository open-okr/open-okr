# Install on one server

For a single machine you control. One Docker Compose file, one script, and a
web wizard. Target: signed in as the owner in under thirty minutes, most of
which is the image download.

PostgreSQL is the only service OpenOKR requires, and this brings its own.

## Before you start

| You need | Why |
|---|---|
| A machine with Docker and Docker Compose | The whole instance runs as containers |
| 2 CPU cores, 4 GB of memory, 20 GB of disk | Comfortable for a few hundred people. Less works; the database is what grows |
| Ports 80 and 443 free | The bundled proxy answers on them. Both are overridable |
| A DNS name pointing at the machine, if you want HTTPS | Certificates are issued automatically for a real name, and skipped without one |

Nothing else. No mail server, no AI provider, no identity provider. Every one
of those is optional and the product is whole without them.

## Install

**1. Get the deployment files.**

```sh
git clone https://github.com/open-okr/open-okr.git
cd open-okr/deploy/docker
```

Only `deploy/docker/` is needed on the server. Copying that directory across
works as well as cloning, and is what an air-gapped install does.

**2. Start it.**

```sh
./openokr up
```

On the first run this generates every secret it needs, writes them to
`./secrets/` with mode 600, pulls the image, starts PostgreSQL, runs the
migrations, and waits until the application answers its own health check. It
prints the address to open when it is ready.

For a real domain with an automatic certificate, name it:

```sh
OPENOKR_DOMAIN=okr.example.com ./openokr up
```

With no domain it serves plain HTTP on `http://localhost`, which is right for
a laptop and wrong for a server anybody else reaches.

**3. Finish setup in the browser.**

Open the address it printed. The wizard asks for one thing: the account that
owns the instance. Name, address, and a password of at least twelve
characters.

Registration closes the moment that account exists. Everybody after you joins
by invitation, which is the point: an instance on the open internet with open
registration is a mailing list.

That is the install. You are signed in, you have a workspace, and both agents
are already members of it.

## What `./openokr up` did

| Step | Detail |
|---|---|
| Generated secrets | A session secret and a root encryption key, into `./secrets/`. **Back that directory up.** The root key is what makes stored credentials readable |
| Started PostgreSQL | In a container, on a named volume. Nothing is exposed outside the machine |
| Ran migrations | From the image, at boot. An upgrade re-runs them the same way |
| Started the application | Then waited for it to report healthy, rather than reporting success at the moment it started a process |
| Started the proxy | Caddy, which terminates TLS and fetches a certificate when you named a domain |
| Checked the proxy is running | An application that is healthy behind a crash-looping proxy is not a reachable instance, and saying "ready" there would be a check that checks nothing |

## Everyday commands

Run these from `deploy/docker/`.

| Command | What it does |
|---|---|
| `./openokr status` | What is running, and whether it is healthy |
| `./openokr logs` | Follow the application log. `./openokr logs proxy` for the proxy |
| `./openokr upgrade` | Pull the new image, restart, re-run migrations, report |
| `./openokr backup` | An encrypted database dump and a copy of the files, with a checksum |
| `./openokr verify-backup DIR` | Prove a backup would restore, without touching the live database |
| `./openokr restore DIR` | Restore from a directory `backup` made |
| `./openokr rotate-key` | Re-wrap every stored secret under a new root key |
| `./openokr down` | Stop, keeping the data |
| `./openokr destroy` | Stop and delete every volume. There is no undo |

## Choices you can make later

Every one of these has a working default, and none of them blocks the install.

| Setting | Default | Change it when |
|---|---|---|
| `OPENOKR_DOMAIN` | unset, plain HTTP on localhost | The instance has a real name |
| `OPENOKR_HTTP_PORT`, `OPENOKR_HTTPS_PORT` | 80 and 443 | The machine already runs something on those ports. Automatic certificates need the standard ports, so moving them assumes your own proxy sits in front |
| `OPENOKR_IMAGE` | `ghcr.io/open-okr/open-okr:latest` | Pinning a version, or running from a mirror |
| Mail | The console driver: messages go to the log | You want invitations and reset links delivered. See [Settings](../admin/settings.md) |
| AI | Off. Every AI affordance is hidden | You want drafting and rewriting. Bring your own key, or a local model |

**Changing the address later is supported and has one consequence.**
`./openokr up` notices a changed public URL and rewrites it, and says so.
Passkeys registered against the old address have to be enrolled again, because
a browser binds a passkey to an origin and nothing can migrate that.

## If it does not come up

| Symptom | What to do |
|---|---|
| "the application did not become healthy in 180s" | `./openokr logs`. A database that cannot start and a bad `DATABASE_URL` both look like this |
| "the application is healthy but the proxy is ..." | `./openokr logs proxy`. Usually port 80 or 443 is already taken |
| The browser cannot reach it | Check a firewall between you and the machine before looking at the instance |
| The wizard says setup is already done | Somebody has claimed this instance. Sign in, or ask them for an invitation |

More in the [incident runbook](../runbooks/incident.md).

## Next

- [The first run](first-run.md): what the wizard did, and the five things worth doing next.
- [Administrator guide](../admin/README.md): people, security, settings, operations.
