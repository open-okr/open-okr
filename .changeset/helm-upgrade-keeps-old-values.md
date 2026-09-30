---
"openokr": patch
---

The Helm chart upgrades a release installed before the virus-scan settings
existed.

`helm upgrade --reuse-values`, which the restore runbook uses, keeps the old
release's values and does not add the chart's new defaults. The deployment read
`scan.clamd.host` as a path, so on such a release the upgrade failed to render
before anything rolled out. It now reads the block as optional, and a release
without it simply has no scan, which is the default anyway.
