---
"@openokr/ui": patch
"@openokr/web": patch
---

The copilot panel is wider and works from the keyboard. It is 512 pixels wide in both densities, where compact used to squeeze it to 320, and Expand widens it to 768 pixels, which the browser remembers. On a phone it fills the screen and keeps clear of the notch and the home bar. Escape closes it and puts focus back on Ask, and so does the close button; Escape is left to the box while something is typed in it. After each question, focus stays in the box for the next one. For screen readers the conversation is a log, and a finished answer, a stop or an error is announced once rather than word by word.
