---
"@openokr/web": minor
---

On a cloud with a plan catalogue, the operator console now marks each workspace that has no plan, because such a workspace cannot use the provider's AI key. A notice above the workspace list counts them and links to a review page. The review lists which workspaces would move onto the default plan and which have more people than its seats, and warns first when the default plan has no AI credits. Confirming moves each listed workspace in its own audited change, and nothing happens without the operator confirming.
