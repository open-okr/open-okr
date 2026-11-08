---
"@openokr/web": patch
---

The AI model list and its prices now match what Anthropic, OpenAI and Google charge today, and cached tokens are counted at their cheaper rate. A workspace that has not chosen its own models moves to the current defaults: Claude Haiku, Sonnet and Opus 5.5, GPT-6 Luna, GPT-6.1 Terra and Sol, and Gemini 2.5 Flash Lite, 3.5 Flash Lite and 3.8 Flash. A workspace that chose an earlier model keeps it. Models you add yourself now work: only the built-in list was being priced, so no OpenAI-compatible endpoint, and no local model outside the list, could ever answer.
