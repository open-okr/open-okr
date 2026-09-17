---
"openokr": minor
---

The audit trail has a screen, and an isolated network has a guide.

**An administrator can check the chain and take the trail away.** Every
sensitive action has been recorded since the first release and hash-chained
since the performance work, and reading either needed a shell on the server.
Now `/admin/audit` says whether the chain is intact and, when it is not, which
position broke and why. The export narrows by date, action or target and hands
over a CSV carrying each row's position and hash, so the file and a later
verification can be lined up against each other by somebody who was not there.

Taking a copy of who did what is itself recorded, with the filter that was
used. An auditor reading the file finds the export at the end of it.

Both are administrator actions. The trail names every actor and the payloads
carry the detail, which is not a thing to hand out in bulk.

**Running with no route to the internet is documented and checked.**
`docs/runbooks/air-gap.md` says what works with nothing configured, what stays
off until it has a connection, and how to install from a loaded image. Its
checklist is not prose: `pnpm check:air-gap` checks each row against the
source and fails if the guide and the product disagree in either direction.
