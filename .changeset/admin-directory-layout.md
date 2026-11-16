---
"@openokr/web": patch
"@openokr/ui": patch
---

The Directory sync page follows the settings layout. The title and intro sit above the cards, SCIM endpoint is a card of its own, and Generate SCIM token sits in the card footer beside the sentence that it replaces any existing token. The endpoint address now has a copy button at its right end, from a new `CopyField` in the interface kit: a check mark shows when it is copied, and where the browser refuses the clipboard the address is selected for copying by hand. Nothing about SCIM tokens or provisioning has changed.
