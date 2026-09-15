---
"openokr": minor
---

The cloud operator console has its first two screens.

A list of every workspace on the instance, and a detail screen for one of
them: who the customer is, how much of the product they are using, and the
control that suspends or closes them.

**Nothing a member wrote appears on either screen**, and that is enforced by
the database rather than by the pages. An operator's connection returns
nothing from any table holding a workspace's content.

Both screens are absent on a self-hosted instance and to anybody without a
live operator grant. Not hidden behind a disabled menu: the routes answer the
same way they would for a page that does not exist.

**The lifecycle control states its consequence before its controls** and names
the workspace inside its own button, because the last thing somebody reads
before freezing a customer's account should be whose account it is. The reason
is required, and it is the sentence that customer's own members are shown.

Usage figures carry the moment they were measured. They are refreshed on a
schedule, and a number with no timestamp beside it invites somebody to act on
a stale one.
