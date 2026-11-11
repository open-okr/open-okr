---
"@openokr/core": patch
"@openokr/agents": patch
"@openokr/web": patch
---

The copilot's answer now knows whether it made a change card. It used to write the answer while the card was still being prepared, so it could say "I cannot create objectives" right above a working card. The card is now prepared first and shown as soon as it exists, and the answer is told what it proposes, so it refers to the card instead of denying it. When no card was made for a request to change something, such as a check-in, the answer says plainly that the copilot cannot make that change yet and where you make it yourself. The first words of an answer arrive one to three seconds later than before, the time it takes to prepare the card. A run delivered twice no longer makes a second card.
