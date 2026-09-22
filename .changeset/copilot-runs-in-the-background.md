---
"openokr": patch
---

A copilot answer survives the page that asked for it.

An answer used to exist only inside one HTTP response. Closing the tab, or
reloading, stopped the run with it: there was nothing still going and nothing
to come back to, and a long question was simply lost.

The answer is now produced by a background job. Asking records the question and
an empty answer together, the job writes the prose, and the panel subscribes to
it. Reloading subscribes again, and a conversation reopened later holds the
answer whether or not anybody was watching when it landed. While a run is going
the answer is marked as still being written, so an empty bubble is never
mistaken for a finished one.

A run that ends early says why, in the conversation: no provider configured,
a provider that would not answer, or a workspace whose AI cost cap says a run
may not spend. The cap is now read before a token is spent rather than after.

An instance that drains its own queue gets all of this. One started with
`OPENOKR_RELAY=off`, which is how an operator moves the relay to its own
process, answers inline exactly as before.

Upgrading applies migration 0098. Nothing needs configuring.
