---
"@openokr/web": patch
"@openokr/ui": patch
"@openokr/core": patch
"@openokr/method": patch
---

Numbers on the OKR screens are easier to type and read.

Values, targets, baselines and weights in the OKR list, drawer and diagram,
on a goal's page and in drafting show numbers grouped the way you read them
(1,234.5), step with the arrow keys, and show the measure's unit beside them.
A value field also says where the measure starts and where it is going, for
example "from 40 to 75 %". Emptying a field records nothing rather than 0.

The unit field suggests the units the cycle already uses, then common ones
(%, people, US$, days, hours, points), and still takes any unit you type.

Breaking for API clients: a weight must be from 0 to 100. A goal or key
result sent with a weight outside that range is now refused with a message,
where it used to be stored as 0 or 100 without saying so. Both importers
still bring a weight outside the range in as 0 or 100, as before.
