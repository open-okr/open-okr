---
"@openokr/web": minor
---

On a cloud instance, a plan can now carry its own limits: `"limits": {"actionsPerMinute": 1200, "concurrentActions": 8}` in the plan catalogue admits that plan's workspaces by those numbers instead of the instance's. Either may be left out, zero is unlimited, and a number below the instance floors is refused.
