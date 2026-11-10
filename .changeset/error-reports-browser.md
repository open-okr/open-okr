---
"@openokr/web": minor
---

Errors in the browser are now reported too: the page sends each unexpected one to the instance's own server, which records it like a server error and, with a tracker configured, sends it on with its frames resolved to source files. Nothing goes from the browser to a tracker directly, and the tracker's address never reaches a page. Every error page has a "Copy details" button that copies the version, the reference, the time and the page for a bug report. The build now writes source maps for the browser's scripts.
