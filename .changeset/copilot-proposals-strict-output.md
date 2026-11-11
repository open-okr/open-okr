---
"@openokr/agents": patch
---

The copilot proposes changes again on OpenRouter and OpenAI. Asked to create an objective, a key result, an initiative or a task, it proposed nothing, and said nothing about why. Those providers fill a structured reply strictly, and the reply's fields were an object with nothing declared in it, so they came back empty and every proposal was dropped. The reply now names every field the offered actions take, and a proposal missing one the action needs is refused where it is read. `pnpm ai:evaluate --provider openrouter` runs the live smoke test against OpenRouter.
