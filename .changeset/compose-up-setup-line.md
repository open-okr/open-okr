---
"@openokr/web": patch
---

`./openokr up` now says "Open … to finish setup" only while setup is unfinished. On an instance that was already set up it printed the same line on every start, which sent operators looking for a wizard that is closed; it now says the instance is ready and where.
