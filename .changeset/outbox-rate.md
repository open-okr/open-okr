---
"@openokr/web": minor
---

An operator can cap how many outbox rows, the mail and nudges a write sets going, the relay claims for one workspace a minute: `OPENOKR_CLOUD_OUTBOX_ROWS_PER_MINUTE`, 60 or more, or 0 (the default) for unlimited. Over it, a workspace's rows wait their turn with nothing refused or dropped, so one tenant's import cannot delay everybody else's. Rows held this way are not counted as relay lag on `/api/status`, and two new gauges, `openokr_outbox_rate_held_workspaces` and `openokr_outbox_rate_held_rows`, show whether the cap is engaging. Migration 0159 adds `outbox.claimed_at`.
