---
"@openokr/web": patch
---

The rhythm streak counts weeks in which a space held its check-in, as the
method defines it, and a week with none breaks it.

It counted every closed session of any kind, so a monthly review added a week
and two check-ins in one week added two, and nothing ever broke it: a space
silent for a month still showed its old number. A monthly or quarterly close
also added a point of 0.0 to the weekly confidence trend, drawing a collapse
that never happened. Weeks are now read in the workspace's own timezone rather
than UTC.
