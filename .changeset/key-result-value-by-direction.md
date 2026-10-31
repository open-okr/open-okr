---
"@openokr/web": patch
"@openokr/ui": patch
---

A key result's value line reads the way the key result moves.

Home, the OKRs list and a space page printed every key result as "{current} of
{target}". A key result that reduces read backwards ("101 of 95 $") and a
maintain key result printed the top of its band as its target ("99.95 of 100
%"). A reduce now reads "101 now, target 95 $" and a maintain "99.95 now, hold
99.9 to 100 %".
