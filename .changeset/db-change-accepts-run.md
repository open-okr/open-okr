---
"@openokr/db": patch
---

`pnpm db:change run` works again. 0.8.0 refused `run` as an argument it did not know, so an upgrade script written for an earlier version, which needed it, stopped halfway at the data changes. `run` is now accepted as the name of the default, which runs every script not yet complete, and the usage line says so. `run --status` is refused as a usage error, since the two ask for opposite things.
