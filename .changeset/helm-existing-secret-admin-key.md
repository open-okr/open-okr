---
"@openokr/web": patch
---

The Helm chart takes `database.existingSecretAdminKey`: with your own database Secret, name the key that holds the owner-role connection and the migration hook reads it from there. Before, `database.adminUrl` beside `database.existingSecret` pointed the hook at a Secret the chart never rendered; that pairing now draws a warning in the install notes.
