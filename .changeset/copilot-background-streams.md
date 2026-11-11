---
"@openokr/core": patch
"@openokr/agents": patch
---

The copilot's answer now appears as it is written. On every deployment that runs background work, which is the usual setup, the answer was produced in the background and arrived in one piece at the end, so the panel stayed empty for several seconds. The words now come through as the model writes them. A streamed answer also records its token count and cost when the provider reports them, as a whole answer always did. If the provider stops partway, the words that arrived are kept and the panel says the answer stopped early.
