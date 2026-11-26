---
"@openokr/web": minor
"@openokr/core": minor
---

The FlowyTeam card on Admin > Import lets an administrator untick kinds of data on the Choose step, as `pnpm import:flowyteam --only` does. Unticking a kind also unticks what needs it, and ticking one ticks what it needs. At least one stays ticked. A preview that covers fewer kinds says "Bringing across" with their names, and Import runs exactly what was previewed. "Import new data" repeats the choice of the last import. `imports.flowyteamPreview` and `imports.flowyteamRun` take an optional `only` list of domain keys, and an unknown key is refused. With no list, every kind of data comes across as before.
