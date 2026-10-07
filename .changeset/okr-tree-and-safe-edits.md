---
"@openokr/web": minor
---

One read for a cycle's OKRs, and edits that never overwrite somebody else's.

`goals.tree` returns a cycle's objectives with their key results, their
owners, their alignment and the dependencies between them, in one call. A
parent outside what it returns, such as the annual objective a quarter's
objectives hang under, comes back as read-only context. `scope: "mine"`
narrows it to what the reader champions, reviews or owns a key result under.

`goals.patch` and `goals.patchKeyResult` change a few fields at once. Each
sends the values it read beside the values it sets. If somebody changed one
of those fields in the meantime, nothing is saved and the call is refused as
a `conflict`, which the REST surface answers with 409 and the values stored
now, who changed them and when. A field the caller is not changing, or a
progress figure recomputed underneath it, never causes a conflict. The target
and the current value keep their own actions.
