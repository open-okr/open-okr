---
"@openokr/web": minor
---

A space's home shows its goals and KPI trees, a member can set their own
picture and bio, and a guest can be invited straight into one space.

**The space home.** It now lists the space's open goals, drawn as the Work
Map's table in the same tree order, and the KPI trees the space owns, drawn as
the KPI tree screen draws them. Each shows only what the reader can open. Both
cards load on their own, with a skeleton while they do and an error card of
their own if they fail, so the rest of the page is never held up. A new read,
`kpis.spaceTrees`, returns one space's KPIs grouped by tree and answers
not-found to anybody who cannot open the space.

**Your picture and bio.** Your own profile has a picture card and a bio in the
shared rich text editor. The picture goes through the same upload path as
attachments, so it is re-encoded and given a thumbnail, and it is shown to the
rest of the workspace while it is your picture and withdrawn when you replace
or remove it. `people.updateOwnProfile` now refuses an avatar that is not an
image, or is a file you could not open, and an emptied bio is stored as no bio.
An administrator still edits another member's name, title and manager, never
their picture or bio.

**Guests.** Admin, Invitations has an "Invite a guest" card: one address, one
space, used once. Accepting makes a guest with nothing on the workspace itself
and view on that one space, and a guest is not a seat. The join page tells the
guest which space they will see. A guest put in a space by hand now sees it
too, where before the space's standard group gave them nothing. A guest who
signs in lands on the spaces they can open rather than on the Work Map.

Migration 0101 adds `member_kind` and `space_id` to `invite_links`. It is
additive, so the previous release keeps working during a rolling upgrade.
