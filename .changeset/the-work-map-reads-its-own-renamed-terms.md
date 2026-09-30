---
"@openokr/web": patch
---

The Work Map now shows a workspace's own renamed terms, not just the canon.

Renaming Objective to Goal on Admin, Rhythm and Thresholds, Terminology
saved and survived a reload, and every screen kept saying Objective
regardless: the setting had a write path and no read path anywhere in the
application. The Work Map and the goals explorer, which share the same
table, now read it back. A single word gets an abbreviation from its own
first letters (Objective stays OBJ, a rename to Goal reads GOA); a
multi-word term takes one letter per word, the same rule Key result already
read as KR.

The other thirteen renameable terms, and the many other screens that name
"objective" or "key result" outright, still read the canon word. Reading
every one of them back is a larger piece of work across many screens, not
attempted here.
