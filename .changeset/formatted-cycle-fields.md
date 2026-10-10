---
"@openokr/web": patch
"@openokr/ui": patch
"@openokr/core": patch
---

The cycle's written fields can be formatted: the annual frame's mission,
vision, strategy and what is not being done, phase 2's three baseline health
columns, and phase 5's record of what was cut.

Each is the same small editor as comments and check-ins, and opens on what
was written, formatting included. Before, the frame and the baseline columns
opened as plain text, and saving them turned any formatting written through
the API back into plain paragraphs. Where the cycle is read rather than
edited, the text is shown as it was written.

Baseline health columns and what was cut take up to 4000 characters, as they
did. The limit is now held by the server as well as the screen, so
`workflow.setBaselineHealth` and `workflow.setCapacityNotes` refuse a longer
document, saying how long it is. `workflow.read` also returns the stored
documents, as `baselineHealthDocuments` and `capacityCutsDocument`, beside
the plain text it already returned.
