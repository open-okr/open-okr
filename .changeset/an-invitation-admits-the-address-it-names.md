---
"@openokr/web": patch
---

A personal invitation now only admits the address it was issued to.

Registering through an invitation link checked only whether the token itself
was still usable, never which address it named. A single-use invitation
issued to one person could be used by anyone holding the link to register any
address, on an instance where registration is otherwise closed to everybody
without one. The registered account also never joined the inviting
workspace: it silently fell through to a brand new workspace of its own,
which is the same failure by a different name.

Registering now refuses an address a personal invitation was not issued to,
and an address outside a shared link's allowed domains, the same rule already
enforced for somebody accepting an invitation while signed in.
