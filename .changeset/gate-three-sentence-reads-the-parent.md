---
"@openokr/web": patch
"@openokr/method": patch
"@openokr/ui": patch
---

The goal page and the drafting list no longer say "no parent, gate 3 is red"
for a goal that has a parent.

Both printed the sentence whenever the contribution statement was empty, while
the side panel showed the parent the goal supports. They now ask the same
question the publish gate asks: a parent, a contribution statement or a reason
to stand alone.
