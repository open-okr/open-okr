---
"@openokr/web": minor
"@openokr/core": minor
---

`sessions.draftNextCycle` and `sessions.proposeFromLearnings` are removed.

Both were deprecated in 0.2.0, when the quarterly review stopped drafting the
next cycle, and announced for removal in 0.3; 0.3 kept them one release
longer. A kept or modified objective reaches the next cycle's Phase 4 on its
own, and an idea reaches its issue list as a learning marked to carry
forward. The drafts already written stay, read-only, so a past review's
minutes still show them.
