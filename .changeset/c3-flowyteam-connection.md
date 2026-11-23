---
"@openokr/web": minor
"@openokr/core": minor
"@openokr/db": minor
"@openokr/adapters": minor
---

A workspace admin can connect FlowyTeam over OAuth with PKCE, approved by a FlowyTeam company admin, and disconnect it again. The access token is envelope-encrypted, re-wrapped by `pnpm keys:rotate`, never logged and never returned, and a disconnect revokes it at FlowyTeam. Migration 0174 adds `import_connections` with row-level security. Three new instance settings: `OPENOKR_FLOWYTEAM_URL` (empty hides the connect step on a self-hosted instance and means app.flowyteam.com on the managed cloud), `OPENOKR_FLOWYTEAM_CLIENT_ID` and `OPENOKR_FLOWYTEAM_CLIENT_SECRET`. Preview and import from the connection follow in a later change.
