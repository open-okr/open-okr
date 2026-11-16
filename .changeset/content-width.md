---
"@openokr/web": minor
---

A member can choose the content width: Compact, the default, caps the page content at 1152 px and centres it, and Full width fills the screen as before. The choice is in the account menu and in Your account, under Appearance, next to Theme, Language and Density, and it follows the member to another machine. Adds the nullable `width` column to `workspace_members` (migration 0171, additive, no backfill; null reads as Compact).
