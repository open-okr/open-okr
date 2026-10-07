---
"@openokr/web": minor
---

Adding objectives and key results from the list, and being told why not.

The topbar has a `+ New` that opens a new objective on the OKRs screen. An
objective added from the list opens with a key result draft under it, and a
new key result is owned by the objective's champion and due on the cycle's
last day. Nothing is written until Enter, Escape leaves nothing behind, and a
refusal keeps what was typed with the reason.

Where the workspace holds new objectives back, for instance a Governed
workspace outside its planning window, "+ New objective" opens the reason
and a link to what resolves it instead of a field the server would refuse.
`goals.creationPolicy` answers whether a new objective may be written in a
cycle now.
