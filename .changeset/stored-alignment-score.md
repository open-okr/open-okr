---
"@openokr/web": minor
---

The alignment score is stored. Every structural write saves its cycle's score beside the findings, and a new read, `alignment.score`, returns it with its band and what it is made of. The Work Map reads that one row instead of computing the whole cascade on every load. The band is read from the cycle's thresholds when the score is read, so moving a workspace's bands shows at once. Cycles from before the upgrade are computed on read until an hourly job stores them, or `pnpm alignment:fill` does it now. Deleting or restoring an objective, changing its level, or removing a key result now also updates the score of the cycles whose objectives hang from it.
