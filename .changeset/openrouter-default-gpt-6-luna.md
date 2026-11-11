---
"@openokr/core": patch
"@openokr/adapters": patch
"@openokr/agents": patch
---

On OpenRouter, the fast and balanced AI tiers now default to GPT-6 Luna, and the deep tier stays on Claude Sonnet 4.5. Luna costs about a thirtieth of Sonnet 4.5 and, run live, passed every capability's evaluation set and filled every copilot proposal. This changes only a workspace or deployment that never chose a model: a model picked on the AI page, or in `ai.deployment.tierModels`, is kept. The recovery-title assist also gets more room to reply, because a reasoning model spends part of that budget thinking and ran out of it.
