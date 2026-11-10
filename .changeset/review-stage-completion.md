---
"@openokr/web": minor
---

The quarterly review's rail marks each stage the room has reached "Done" or "Not done" against its completion condition, and beside the advance an unfinished stage says what is missing, such as "2 key results have no score and reason yet", with "Move on anyway". A condition is shown, never enforced: only scoring still refuses to close while a committed miss has no explanation. The team retro has no condition, because nothing records when writing or voting ended. The new read `sessions.stageCompletion` is in the API at view access. The root-cause stage now reads as complete when everything graded cleared its threshold.
