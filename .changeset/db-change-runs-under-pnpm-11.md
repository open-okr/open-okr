---
"@openokr/web": patch
---

`pnpm db:change` runs the data changes again.

pnpm 11 has a `change` command of its own, so the script opened pnpm's prompt
instead of running anything. It now names `run` explicitly. This is the command
an upgrade tells you to run to seal identity-provider tokens stored before they
were encrypted.
