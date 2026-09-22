---
"openokr": patch
---

Every sentence on screen is one message again.

Moving the interface's text into the message catalogue split every sentence
that had a number or a name in the middle of it. A catalogue held entries like
"at", ", and" and "minutes. A shorter window means more messages", each one a
piece of a sentence fixed in English word order by the markup around it. A
translator handed "at" has no way to know what it attaches to, let alone where
their own language puts it.

193 messages now carry named holes, so a sentence is whole and the hole goes
wherever the language needs it. Nothing a reader sees has changed, with two
exceptions: on the device approval page and the workspace import card, one word
that was styled inline is no longer styled, because styling a word inside a
sentence means cutting the sentence at that word.

A check refuses a new message rendered beside a value, so the pile cannot come
back.
