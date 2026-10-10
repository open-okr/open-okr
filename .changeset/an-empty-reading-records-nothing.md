---
"@openokr/web": patch
---

Saving an empty value from the Work Map no longer records 0.

The side panel's "Record a value" box read an empty box as 0, so pressing Save
after clearing it wrote a real reading of 0 into the key result's history and
moved its progress. The box is now required, and an empty value is refused
with "Type a value before saving." instead of being recorded.
