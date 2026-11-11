---
"@openokr/ui": patch
"@openokr/web": patch
---

While the copilot works on an answer, one line says what it is doing, replaced in place: searching your workspace, what it found, checking whether your question is a change it can make, writing the answer. Each step stays long enough to read. Once the words start, the steps fold into one quiet line, such as "Searched your workspace, found 3 passages", that opens to list them. Arriving text ends in a caret that goes when the answer is done. With reduced motion turned on, the caret and the line do not move. A screen reader hears "Answering", then a step at most every two seconds, then "Answer ready" or "Stopped", once each. When you stop an answer the server is writing in the background, the words that arrived stay on screen, marked Stopped, while the copilot saves them.
