---
"openokr": minor
---

The demo now holds a quarter that is already over.

`pnpm db:seed` used to build one quarter, mid-flight, with an empty scorecard.
The note beside it was honest about why: scoring at the quarterly review had not
been built yet, and seeding invented scores would have put a number on a screen
that no review agreed. Scoring shipped, and the note stayed.

So the demo of a product whose closing argument is "did we miss because the
strategy was wrong, or because the cadence broke" had nowhere to show that
argument. It does now. The seed runs a whole review of the previous quarter
through the ordinary actions: two objectives, five key results each graded with
a one-line reason, the scores revealed, the process-health survey answered, the
diagnostic recorded, the session closed and the cycle snapshotted.

The result is a scorecard with last quarter on it, goal pages with scores, and
a diagnostic reading "strategy or OKR-quality problem" out of a cycle score of
0.58 against a rhythm score of 4.0. Nothing writes that verdict. It is derived
from the two numbers, so changing either threshold changes what the demo says.
