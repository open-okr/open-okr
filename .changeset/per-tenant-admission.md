---
"openokr": minor
---

One workspace can no longer slow down everybody else on the same server.

A cloud deployment can now cap how many actions one workspace runs a minute
and how many it runs at once. Both caps are off by default and stay off
unless an operator sets a number, so a self-hosted instance is never limited
by a value nobody chose.

**The cap sits at the one door every surface comes through**, so it covers
the browser, the REST API, the command line, an agent calling a tool and a
slash command in chat. The rate limits that existed before this lived in the
web routes, which meant an agent or a chat command was never limited at all.

**A workspace over its cap is told when to come back.** The refusal carries
the number of seconds until the window resets, and the REST API sends it as
a `Retry-After` header, so a client waits instead of retrying in a loop.

Nothing that was already agreed to is thrown away: a queued job is never
dropped, and a side effect written inside a transaction that already
committed is never refused.

A number below its floor is refused when the instance starts, with a message
naming the setting, rather than being accepted and quietly stopping the
product.
