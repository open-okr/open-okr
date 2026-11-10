---
"@openokr/web": minor
---

A prompt version saved on Admin, AI is now checked against that prompt's evaluation set before it is kept, and a version that fails is refused with the checks it failed: personal data in the prompt, a prompt too long for every call to carry, or the product no longer handling a reply the way it should. The checks run against a stand-in model on the server, so nothing is sent anywhere and no provider is needed. A saved version is now actually sent to the model, which it never was before, while it passes its set; one that does not, including one saved before this release, is skipped and the built-in text is sent instead. The usage card shows each prompt's latest evaluation results, and `pnpm ai:evaluate` prints the whole set, or runs it against a real model with `--provider` and `--model`.
