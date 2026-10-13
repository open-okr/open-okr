---
"@openokr/web": patch
"@openokr/ui": patch
"@openokr/core": patch
---

Text can be underlined in every editor: from the toolbar's Underline
button, with Ctrl+U (Cmd+U on a Mac), or by pasting underlined text.
Importing HTML keeps `<u>` as underline too.

0.3.0 taught every reader the mark first, so a document written with an
underline here opens in an editor still running 0.3.0 during an upgrade.
