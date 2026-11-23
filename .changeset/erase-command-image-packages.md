---
"@openokr/web": patch
---

Fix `openokr erase` failing inside the image: the command loads the settings registry, which needs the formats and method packages that the migrator layer did not ship.
