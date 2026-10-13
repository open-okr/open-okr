---
"@openokr/web": patch
"@openokr/ui": patch
---

Confidence is shown the way your workspace chose.

The practice setting "Confidence shown as" now does what it says. With the
default, "x in 10", a confidence of 0.7 reads "7 in 10" wherever it is typed
or shown; "0.0 to 1.0" shows 0.7, and "Percent" shows 70%. It is still stored
as 0.7.

Every place confidence is set uses one field: the check-in composer, the
OKR drawer's check-in, a key result on its goal page, a confidence vote and
the correction on the check-in history. The sliders, which never showed
their value, are gone. The field names the confidence band beside the number
(High, Medium or Low), from your workspace's own thresholds.

Fixed: emptying the confidence on a check-in, a correction or a vote used to
record a confidence of 0. Publishing or voting now asks for one, and a
correction keeps the confidence it had.
