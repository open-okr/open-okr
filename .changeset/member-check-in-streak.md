---
"@openokr/web": minor
"@openokr/core": minor
"@openokr/method": minor
"@openokr/ui": minor
---

A member sees their own check-in streak on the check-in page.

It counts the periods in a row in which they posted a check-in on a goal they
champion, by the same rule as the space's streak. It is paused, and names the
goal, while one of their goals reads on track with a key result that has not
moved past the divergence window, so re-entering the same number does not keep
it alive. A new read action, `goals.myStreak`, serves it and is in the agent
`core` toolset.
