---
"openokr": minor
---

A workspace archive now moves between instances with its people and its files.

- **A passphrase seals it.** Exporting asks for a passphrase of at least 12
  characters, and any instance given it can import the archive. Archives used
  to be sealed with the exporting instance's own encryption key, so moving
  from the cloud to a self-hosted install would have meant handing over the
  cloud's key. Archives from earlier releases still import on the instance
  that wrote them.
- **People can claim themselves.** Every member now travels with their email
  address. When that person joins the receiving workspace, they take over
  their member and everything it wrote, instead of getting a second, empty
  membership. The same applies to people a FlowyTeam import brought in.
- **Files come back.** An import writes every file's bytes back into the
  receiving instance's storage. Before, files arrived as names with nothing
  behind them.

The export card on the admin imports page also works again: it could not seal
an archive at all, because it was never given what it needed. The archive
format is now version 2.
