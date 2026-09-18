---
"openokr": patch
---

Documentation an administrator can follow without reading the repository.

`docs/README.md` is the index, sorted by who you are rather than by how the
product is built: installing, administering, or running the practice.

The install quickstarts cover one server with Docker Compose, Kubernetes with
Helm, and the managed cloud, each written from what the deployment actually
does. The Compose page says what the first `up` generates, what it waits for
and why, which commands you will use afterwards, and the one consequence of
changing the instance's address later.

The administrator guide covers people and access, security, settings and
operations: who can get in, what happens when somebody leaves, which settings
change behaviour, and how backups, upgrades and key rotation work.

The user guide, the OKR handbook and the API reference follow.
