---
"@openokr/web": patch
"@openokr/core": patch
---

`pnpm db:seed --year` builds the Northwind year: the scenario in
`docs/scenarios/northwind-year` placed on the real calendar, with every
event dated on or before today written and nothing after it. Each date
keeps its distance from its quarter's first Monday, so a Monday check-in
stays a Monday in any year.

This first part writes the year's frame: fourteen people with the days they
arrive and leave, nine spaces with Support archived and Growth formed on
their own dates, "Team" in terminology, the year's practice settings
changes on their dates, eleven KPIs judged by their own thresholds with a
reading for every month as it is recorded, and the annual frame with its
four objectives, published. The quarters follow in later parts.
