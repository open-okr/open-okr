---
"@openokr/web": minor
---

A custom agent's instructions now do something. Each agent on Admin, Agents shows its instructions for planning (cycle phases 0 to 5) and for running (6 and 7), with every saved version and a Restore. With an AI provider configured, "Plan a run" asks the model for the agent's next tasks, from those instructions and the goals and KPIs its bindings reach, checks every task (never a destructive one), and shows the plan before anybody starts it. The Coach's and the Champion's instructions are shown read-only, because they follow the method.
