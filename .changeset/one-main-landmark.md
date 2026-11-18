---
"@openokr/web": patch
---

Admin pages now have one main landmark. The admin layout drew a second `main` inside the app shell's, so a screen reader announced two. The inner one is now a plain container and the skip link still lands on the shell's `main`.
