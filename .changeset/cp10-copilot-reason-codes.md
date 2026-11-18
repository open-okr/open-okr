---
"@openokr/web": patch
---

The copilot panel now words the reason it did not answer (AI off, no plan, cost cap, provider error, stopped partway) from the message catalogue, so a Malay reader no longer gets those reasons in English. `copilot.thread` and `copilot.availability` also return a reason code and its values beside the English sentence, which is unchanged.
