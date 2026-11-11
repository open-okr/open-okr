---
"@openokr/web": patch
"@openokr/ui": patch
---

On the cycle's Prepare phase, saving the first note on an empty input-pack item now marks that item gathered, so the item no longer reads Missing right after you record where it is. After that only the box beside the item changes its status, so editing a note never moves it. The box now looks like a checkbox you can press, with a hover state and a tooltip naming what pressing it does, and the ticks on the input pack and the phase list are drawn as icons rather than a text character.
