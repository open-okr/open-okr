---
"@openokr/web": minor
---

An administrator can make another member an administrator, and step down.

Until now only the person who created the workspace could ever have full
access: invitations grant standard access at most, and nothing on screen or
in the API could change it. A workspace whose founder left had no
administrator. Each person's profile now has "Make administrator" and "Remove
as administrator" for administrators to use. The last administrator cannot
step down, and is told to hand over first. Agents and guests cannot be made
administrators. New API action: `people.setAdministrator`.
