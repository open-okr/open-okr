---
"openokr": patch
---

The branding card looks like a card, and the quality word lists can be read.

The branding admin screen was still the scaffolding it shipped with: a label, a
line break, a bare input and two browser-default buttons. Tailwind's reset
strips an input's border, so the one setting on that screen appeared as grey
placeholder text with no visible field to type in, and the two buttons appeared
as two lines of plain text. The general settings card had the same problem and
was rebuilt; this was the copy that pass missed.

It now uses the same card, field and button treatment, with the two controls on
one row rather than stacked, a swatch showing the colour in force, and a field
that refuses a value the server would refuse anyway instead of appearing to
save it.

The rhythm and thresholds screen printed the six quality word lists as one
paragraph of JSON: 148 terms of quotes, brackets and commas that ran past the
right edge of the card. They are now six named lists with their term counts,
and they wrap. They stay read-only, which was a deliberate choice rather than
an omission.
