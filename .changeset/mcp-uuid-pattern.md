---
"@openokr/core": patch
---

The agent tool catalogue is smaller: an identifier field says `format: uuid`
and no longer repeats the long regular expression beside it. The default
toolset drops from about 47 KB to 33 KB. The server validates every call as
before.
