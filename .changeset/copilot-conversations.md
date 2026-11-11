---
"@openokr/core": patch
"@openokr/ui": patch
"@openokr/web": patch
---

The copilot keeps your conversations apart. New chat in the panel's header starts an empty conversation, so a new topic is no longer asked inside an old one (which also sent the old turns to the model). History lists your conversations grouped by when you last used each, Today, Yesterday, This week and Earlier, with the open one marked, and you can delete one after confirming it in its row. The open conversation is in the page's address, so a reload or Back brings it back. The new `copilot.deleteThread` action, in the REST API, the command line and the agent tools, deletes one of your own conversations; it needs the destructive scope, and it is recorded in the audit log.
