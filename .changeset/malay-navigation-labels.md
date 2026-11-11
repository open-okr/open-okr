---
"@openokr/web": patch
"@openokr/ui": patch
"@openokr/core": patch
---

In Bahasa Melayu the sidebar, its block headings, the bottom bar on a phone, the search palette, the account rows of the avatar menu and the admin sections are in Malay, and so is a built-in role's name (Pemilik, Pentadbir, Ahli, Pemerhati). They were all in English. A workspace's own words for its terms still win, and a role the workspace made keeps the name it was given. `people.readMember` returns the role's built-in key as `roleKey`, or null for a role the workspace made.
