---
"@openokr/web": minor
---

Any write on the REST API can now be checked without committing it: add `?validate=true`, or `--validate` to an `okr` command. The instance runs the write's own checks and access rules, then rolls everything back, and answers the input with its defaults filled in and what the write would have returned, or the same refusal the write would give. A few writes that are not one database operation answer 400 instead, and the OpenAPI document marks every write that can be checked.
