---
"@openokr/web": patch
---

`./openokr upgrade` names the image it is replacing and the backup it has just
written, so the rollback it prints can be copied as it stands:

```
openokr: current image: ghcr.io/open-okr/open-okr:0.3.1
openokr: to roll back: ./openokr restore ./backups/20261015T030030Z/,
openokr: then OPENOKR_IMAGE=ghcr.io/open-okr/open-okr:0.3.1 ./openokr up.
```

It printed the raw JSON of `docker compose images` before. The install guide
also names Docker's own message for a port that is already taken, and says how
to start on others.
