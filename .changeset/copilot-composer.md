---
"@openokr/web": patch
---

The copilot's question box is one rounded box with its button inside, the way current chat products draw it. It starts as one line and grows as you type, up to 40% of the panel, then scrolls. Enter sends, Shift+Enter starts a new line, and the Enter that confirms a word in a Japanese, Chinese or Korean input method no longer sends a half-typed question. You can type your next question while an answer is still arriving. The send button turns into Stop in the same place while the answer can be stopped, and Stop now stops an answer the server is writing in the background as well. If a question does not reach the copilot, it comes back to the box with the reason under it, rather than being lost.
