---
"@openokr/web": patch
"@openokr/core": patch
"@openokr/ui": patch
---

A new objective can be filed under a space when it is drafted.

The drafting form on phase 4 created every objective with no space, so a
space's weekly session had no key results to vote on, its page listed no
goals, and a quarterly review in it could grade nothing. The form now has a
space picker, and "Open drafting" on a space's page starts it on that space.

Filing a new objective under a space asks edit on that space, the same
question moving one there already asks, and refuses a space that is not in
the workspace.
