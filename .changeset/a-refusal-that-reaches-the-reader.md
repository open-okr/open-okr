---
"openokr": patch
---

A save that is refused now says so where you are looking, and keeps what you
typed.

On the rhythm and thresholds screen the reason a save was refused appeared at
the top of the card. A card there runs to seventeen hundred pixels and its Save
button stays in view as you scroll, so pressing Save near the bottom of one
produced no visible response at all: the sentence was above the window, inside
a card you were already in.

Worse, the value that was refused did not survive being refused. Type 500 where
the method allows 200, press Save, and the box was back to 200 before the
refusal could be read, which left the message describing a number no longer on
screen. That had been true since the card was first made editable.

Three things carry the outcome now. A message appears in the corner of the
window and clears itself. The field the method named is scrolled into view,
given focus and marked as the invalid one, with the reason printed under it.
And what was typed stays in the box, so fixing it means changing a digit rather
than typing the whole thing again.

The messages are new to the product generally, not only to this screen. The
interface design has called for them since the beginning, for confirming a
save, for offering an undo instead of an "are you sure" dialog, and for telling
a screen reader that something happened. Nothing had ever built them.
