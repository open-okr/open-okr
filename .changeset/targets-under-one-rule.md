---
"@openokr/web": minor
---

A target now moves under one rule all cycle, and the once-a-cycle calibration
is retired (METHOD.md §2.9, §7.6). Phase 6 states the rule rather than
offering a calibration form, and `workflow.calibrate` is removed from the API,
the command line and the agent tools; a calibration recorded before still
shows, as history. The quarterly review's scoring stage now shows, beside a
key result whose target moved, the target it began the cycle with and the
reason it was eased, and `sessions.scoringStatus` answers both as
`originalTarget` and `easedBecause`.
