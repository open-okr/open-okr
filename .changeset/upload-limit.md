---
"@openokr/web": patch
---

Files up to the real limit, 25 MB, can be attached again. Uploads stopped at 8 MB with a generic failure, because the server's request limit was lower than the file limit. The attach control now says the limit, and refuses a larger file before sending it.
