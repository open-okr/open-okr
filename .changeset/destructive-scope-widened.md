---
"@openokr/web": minor
---

Closing a cycle or a session, suspending a member, making a member a guest and changing the workspace's state need the destructive scope from an API token or an agent connection. A token with read and write is refused, naming the scope. The browser is unchanged.
