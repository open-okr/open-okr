---
"@openokr/core": patch
"@openokr/web": patch
"@openokr/ui": patch
---

The operator console now says when workspaces are missing from its list because they were made before the instance became a cloud, and offers Adopt now. Turning the cloud flag on after workspaces existed showed "0 tenants" until the hourly adoption ran. Adopt now runs the same adoption as `pnpm cloud:adopt`, only for an operator, and writes an instance audit entry naming who pressed it. An instance with no workspaces at all keeps its empty state.
