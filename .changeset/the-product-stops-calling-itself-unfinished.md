---
"@openokr/web": patch
---

The product no longer tells people that finished parts of it are missing.

The first-run wizard, the first screen of every install, said chat channels
and the AI provider were "Not in this build", long after both had shipped. It
now says both are optional, which is true: channels are connected per
workspace after setup, and every feature works without an AI provider. When a
deployment-wide provider is configured, the wizard names it.

The cycle screen said parts of each phase "arrive at" internal task numbers,
and four other screens and one API description did the same. All of them now
say plainly what could not be read, or what the screen is for.
