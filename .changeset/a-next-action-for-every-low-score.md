---
"@openokr/web": minor
---

The weekly session's step 2 is now "Discuss what dropped" (METHOD.md §7.2).
It lists every key result scored low, and every one whose confidence fell
since the last session that scored it. A low score needs a next action and
its owner, due by the goal's next check-in, before the session moves on; a
blocker is raised beside it only where something is actually blocked, and a
blocker's own next action answers the score too. The session used to ask for
a blocker on every low score.

Two new actions, `sessions.setNextAction` and `sessions.lowScores`, and three
columns on a session's confirmed confidences hold the next action, its owner
and when it is due (migration 0129).
