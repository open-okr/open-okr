---
"openokr": patch
---

A run started for a custom agent now actually runs, one task at a time, and
the agents screen shows how far it got.

Starting a run through the API, the command line or the agent endpoint wrote
the run and nothing else, so it sat at its first task forever and said it was
running. Starting one now queues its first step in the same save, and each
step queues the next, so a run carries on after a restart from where it was.

Every rule an agent works under holds at every step. It acts only inside the
spaces, goals and KPI trees it is bound to. A write becomes a proposal in the
review queue unless an administrator has let that agent write directly, and in
sandbox mode nothing is saved at all. A read is never turned into a proposal.

A run stops, with the reason written on it, when the agent is turned off, when
the workspace has no AI provider for the agent's tier or its privacy settings
let nothing reach the provider, when the per-run cost cap is zero, or when the
workspace's or the agent's own AI budget is spent. The OKR Coach and the OKR
Champion are unaffected and keep working with AI switched off.

A task that names an action the product does not have is refused when the run
is started, rather than failing later or waiting in the review queue as a
proposal nobody could apply.
