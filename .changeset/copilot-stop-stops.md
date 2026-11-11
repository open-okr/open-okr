---
"@openokr/core": patch
"@openokr/web": patch
---

Stop now stops the copilot's answer. On every deployment that runs background work, which is the usual setup, pressing Stop only stopped the panel listening: the answer carried on and arrived anyway. The panel now tells the run to stop, the run ends at the next piece it writes, and the words that had arrived are kept as a stopped answer. Nothing more is generated, so nothing more is paid for. A stop pressed while the copilot is still searching ends the run before it spends anything.
