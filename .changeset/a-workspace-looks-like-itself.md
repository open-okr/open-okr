---
"@openokr/web": minor
---

A workspace's brand colour and its own words for the method's terms now reach
its screens.

Both were saved on the admin screens and read by nothing. The branding card
said a saved colour was "in force across this workspace" while every screen
stayed indigo, and a workspace that renamed "Space" to "Team" still read
"Spaces" everywhere.

**The brand colour** becomes the buttons, links, progress bars and focus rings
on every screen of the workspace, in light and dark, without a rebuild. Each
shade is weighted so its text stays readable at WCAG AA: a colour too light to
carry white text is darkened for buttons, and the card names the shade in
force. Red, amber and green are refused, on the card and through the API,
because they mean off track, at risk and on track; the card says so in words
instead of appearing to save. A status colour stored before this release is
not applied, and the card says that too. The sign-in page and emails do not
carry the colour.

**A renamed term** shows in the sidebar and in the main screens' headings,
create buttons, counts and empty states: the Spaces, KPIs and Cycles pages,
drafting's Add objective and Add key result, the goal page's key results,
search and inbox labels, and the champion, reviewer, sponsor and facilitator
fields. A rename is the organisation's own word, so it reads the same in
English and Bahasa Melayu; a term nobody renamed reads in each person's own
language. Rule names, coaching messages, longer explanatory sentences, emails
and chat messages keep the method's words.

Two English headings changed wording so they can hold any term: "Add a KPI"
is now "New KPI" and "Create a space" is now "New space".
