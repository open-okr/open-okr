---
"@openokr/web": patch
---

A file between 10 MB and 25 MB can be attached. The proxy in front of every request kept only the first 10 MB of a body, so such an upload reached the server cut short and the page failed with an error. It now buffers up to 27 MB, the same as the upload action itself.
