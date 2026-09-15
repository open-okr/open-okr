---
"openokr": minor
---

The vendor can say something to everybody, and an operator can see what the
instance is.

A site message reaches every workspace, or only the ones it names. It carries
a tone, a window it shows in, and whether people can dismiss it. **The window
is required rather than optional**: a message with no end is a banner
everybody learns to ignore, and the next one is ignored with it. A message
whose window has passed stops showing without anybody removing it.

**Dismissing belongs to the person, not to their membership.** Somebody in
three workspaces meets an instance-wide sentence once and dismisses it once,
and dismissing hides it from them and from nobody else.

The message body is plain text. It reaches every customer at once, which is
the worst place in the product to add a surface that needs sanitising, and a
maintenance notice needs a sentence rather than a heading level.

**The operator console lists the instance's own flags**, each with what it
does, whether it is on, and whether that came from the database, the
environment or the default. The list is derived from the settings registry, so
a flag added later appears without anybody maintaining a second list. It is
read-only there: changing a mail host from a console that lists every customer
is a different job with a different blast radius.
