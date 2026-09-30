---
"@openokr/web": minor
---

Anthropic, OpenAI, Google, a local Ollama and any OpenAI-compatible endpoint
now work. Until now only OpenRouter did.

Every model call was built as OpenRouter whatever a workspace had configured,
so a workspace that set up any of the other five providers found every assist,
the copilot and the agents' drafting behaving as though AI were switched off.
Calls now go to whichever provider the workspace routes each tier to, with that
provider's own key and address. A local Ollama, which needs no key, is picked
up from its settings alone, which is what makes a fully air-gapped model work.

On the managed cloud, the address an administrator gives for Ollama or an
OpenAI-compatible endpoint is checked on every request, and a private or
reserved address, or a redirect, is refused. On a self-hosted instance a
private address is allowed, because that is where a local model runs.
