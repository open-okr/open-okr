---
"@openokr/core": minor
"@openokr/ui": patch
---

Two new agent toolsets. `room` holds the live session's own moves (votes and
their reveal, the mic, pulse, kudos, retro notes, anonymous process-health
answers), split from `facilitation`. `integrations` holds AI providers, chat
channels, single sign-on and spreadsheet imports, split from `admin`, which
was over the 128-tool cap some clients apply. The default `core` toolset now
also publishes and approves a drafted objective. An address that named
`facilitation` or `admin` for one of the moved tools adds `room` or
`integrations`.
