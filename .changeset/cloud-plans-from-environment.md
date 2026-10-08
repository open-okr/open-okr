---
"@openokr/core": patch
---

An operator's plan catalogue can be set with `OPENOKR_CLOUD_PLANS`.

The plans offered on the operator console were read from a settings row that
nothing wrote and no page described, so a cloud instance offered Free and
nothing else. The variable now bootstraps the catalogue as JSON, a stored
catalogue still wins, and the cloud install page says how.
