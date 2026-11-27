---
"@openokr/web": minor
"@openokr/core": minor
---

Admin > Import gains a "From FlowyTeam" card: connect, see what is brought across, preview, import, then invite the people who came across. The preview shows what will be added, what is already here and what is skipped, names KPIs that will become more visible and holds the import until the admin ticks that they accept it, and lists what changed on the way in and what is not brought across. Progress shows live while the background job runs, and the page can be left. After an import, the invite step lists the imported people who have no account; nothing is sent until the admin chooses people and presses Send, and "Not now" sends nothing. A linked workspace offers "Import new data", which adds what is new and changes nothing already imported. Every refusal (FlowyTeam unreachable, an older FlowyTeam, revoked access, background work off) is said in the reader's language. New read `imports.flowyteamPeople` for the invite step. Connecting FlowyTeam is now offered on every instance: an empty `OPENOKR_FLOWYTEAM_URL` means FlowyTeam's cloud at https://flowyteam.com, on self-hosted instances too, and nothing is contacted until an administrator presses Connect. Set it to `off` on an air-gapped instance to hide the step; the card then shows the command-line import instead.

In Recent runs, a preview now says how many rows it would write rather than "written", for spreadsheet previews too.
