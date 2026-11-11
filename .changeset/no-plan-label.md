---
"@openokr/web": patch
"@openokr/ui": patch
---

On a cloud with a plan catalogue, a workspace that has no plan is shown as "No plan": on its page in the operator console, in the console's plan filter, and on the workspace's own Plan and seats page. It was shown as "free" or "Free", the same word as a plan in many catalogues. Without a catalogue, where Free is the only plan, nothing changes.
