---
"@openokr/web": minor
"@openokr/core": minor
"@openokr/method": minor
"@openokr/ui": minor
---

The review inbox can be cleared.

Each acknowledgement row shows the check-in's status and the first line of what
it says, and "Acknowledge all" acknowledges every listed one in one press. A
check-in nobody acknowledged within 14 days lapses: it leaves Review and the
acknowledgement ladder stops asking, and it is not recorded as acknowledged.
The window is the new §11 threshold `cadence.acknowledgementWindowDays`, which
a workspace can change in Admin, Rhythm.
