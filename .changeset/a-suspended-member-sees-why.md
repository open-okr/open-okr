---
"@openokr/web": patch
---

A suspended member sees why, instead of a crash page that blames the app.

Signing in as a member whose access had just been suspended landed on
"Something went wrong. We could not load your workspace. This is our fault,
not something you did." on every page they tried next. The reassurance was
wrong: the access-scoped reads that load the app shell correctly refuse a
suspended member by design, and nothing caught the refusal before it fell
through to the framework's generic error boundary.

The shell now catches that refusal once, in the one place every
authenticated page shares, and shows "Access suspended" with what to do:
sign out, or ask an administrator if this looks wrong.
