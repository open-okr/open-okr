---
"@openokr/web": minor
"@openokr/core": minor
"@openokr/adapters": minor
---

A connected workspace can preview and run the FlowyTeam import from the server: `imports.flowyteamPreview` and `imports.flowyteamRun` record the run and queue a background job, which reads FlowyTeam's read-only export over HTTPS (`POST /api/export/v1/query`, `GET /api/export/v1/files/{id}`), runs the same engine as `pnpm import:flowyteam`, and publishes progress per domain. A real run past ten minutes continues in a follow-up job from its next domain. The run is refused before any write when the latest preview named KPIs that will become more visible and the admin did not accept that, when FlowyTeam runs another version of the query catalogue, when FlowyTeam no longer accepts the token (the connection then reads as revoked), and when `OPENOKR_SCHEDULER=off` means nothing would run the job. `imports.listRuns` gains `via` (`export` for these runs). Every catalogue statement FlowyTeam pages now has a deterministic order, so the catalogue version changes and FlowyTeam must vendor the new `contract/flowyteam-queries.json`.
