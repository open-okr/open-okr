---
"@openokr/web": patch
"@openokr/ui": patch
"@openokr/core": patch
---

People, spaces, roles and admin settings are found by typing, and no id is pasted.

A member's manager, a leave delegate, adding somebody to a space, a new
space's manager, a member's role, the audit filter's "who", a guest's space
and a reminder's channel template are now lists you can search.

Three admin fields asked for an id or a model name to be pasted or typed. An
agent's scope now finds its space, KPI tree or goal by name (goals by
searching, since a workspace can hold thousands). A budget names whose it is,
the whole workspace, a person or an agent, in one choice, and the budget
list shows that name instead of part of an id. A tier's model is chosen from
the catalogue on the same page, and the choice carries its provider.

For API clients: `search.entities` takes an optional `kinds`, to search only
some kinds of thing.
