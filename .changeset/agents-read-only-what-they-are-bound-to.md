---
"@openokr/web": minor
---

The Coach and the Champion read only what they are bound to, and an agent in
sandbox mode no longer changes anything.

Both agents were given access to named spaces and never to the whole
workspace, and then read every goal, KPI, blocker and session regardless. The
Coach sent the titles it read to the AI provider. They now read through their
own access, the same way a person does. So that nothing drops out of their
sight, both are also given access, by name, to every company goal, individual
goal and KPI that belongs to no space, as each is created. `pnpm db:change`
does the same for the ones that already exist, and gives each such KPI the
access record it has never had.

Sandbox mode was supposed to commit nothing. The two built-in agents ignored
it and sent their nudges and wrote their proposals anyway. A sandboxed run now
works everything out, records what it would have done as simulated, and
changes nothing else. The demonstration instance runs both agents once before
putting them in sandbox, so its nudges still come from the product.
