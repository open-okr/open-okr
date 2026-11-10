---
"@openokr/web": minor
---

An operator can start, extend or remove a trial on a workspace's console page: a plan, an end date and a reason the customer reads in their audit log. An hourly job ends each trial past its date: a live subscription carries on, people who fit the default plan move to it, and otherwise the workspace goes read-only, with nobody removed, until somebody subscribes or makes the people fit and presses Settle. Extending the trial lifts that read-only mode. `pnpm cloud:trials` lists what is due, and `--write` ends them now. Nothing happens on a self-hosted instance.
