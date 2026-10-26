---
"@openokr/web": patch
"@openokr/ui": patch
---

Four buttons now carry the words they show in their names, so a speech user
who says what they see reaches them (WCAG 2.5.3, label in name). axe 4.14
checks this on every screen.

- The copilot's **Ask** button keeps its ⌘J hint beside it rather than inside
  it, and announces the shortcut itself.
- The account menu is named with the initials its avatar shows, for example
  "Account menu, AA".
- On the diagram, **+ KR** is named "KR: add a key result to …" and
  **Move under…** is named "Move under another objective or key result: …".
