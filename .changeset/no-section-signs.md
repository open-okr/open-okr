---
"@openokr/web": patch
"@openokr/ui": patch
"@openokr/method": patch
"@openokr/core": patch
"@openokr/importer": patch
---

No screen, message, API description, command help or import report cites a specification section ("§2.9") any more, and no API description names a screen code ("Drives screen S-27"). Each sentence now says what it means in words. The Grafana dashboard "the §13.1 budgets" is now "Performance budgets". The practice settings screen no longer prints a section and source under each setting, and its "As §4" and "As §8.4" options read "As the method". The KPI trees page no longer lists unbuilt work under "Not here yet". The `section` field that `practice.read` and `rhythm.read` return is now the section number alone, "4.5" rather than "§4.5".
