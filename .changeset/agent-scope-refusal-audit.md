---
"@openokr/web": patch
---

An agent connection refused a tool beyond its scope now leaves an audit row naming the member, the tool, the scope it needed and the channel. The activity it writes is private, so a retrying agent cannot fill the feed.
