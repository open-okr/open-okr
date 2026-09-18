# P8-T15: the two unstable end-to-end specs

Two specs failed about one run in four when the suite was run eleven times in
one day on 3 September 2026. This names the cause of each, records the fix, and
says what the evidence is and what it is not.

A third turned up while gathering that evidence, in the flakiness report this
task added. It is here too, because the reason it had never been seen is the
same reason the first two took eleven runs to notice.

## What was recorded, and when

| Spec | Symptom | Recorded |
|---|---|---|
| `e2e/s36-channels.spec.ts` | The quiet-hours field fails a `toHaveValue` | 3 September 2026 |
| `e2e/sessions.spec.ts` | The last stage fails a click on a 4-second timeout | 3 September 2026 |

Continuous integration retries twice, so neither ever held the pipeline. That
is what made this a Phase 8 row rather than a Phase 6 one, and also what would
have hidden it indefinitely.

## Spec one: the quiet-hours field

### Cause

The quiet-hours inputs are uncontrolled. They carry a `defaultValue` from the
server render and React takes ownership of them at hydration.

Playwright's `fill` can land in the window between the HTML being in the
document and React hydrating it. Hydration then resets the DOM value to what
the server rendered, so the typed value is gone, the form posts the old window,
and the assertion afterwards reads as "the write did nothing".

**It is a race in the test, not a defect in the product.** A person typing into
the field cannot hit the window, because they cannot see the field before it is
painted and they do not type within milliseconds of that.

### Why the obvious fix does not work

Retrying the assertion cannot help. By the time the assertion runs, hydration
has already discarded the value, and no amount of waiting puts it back. A
longer timeout on `toHaveValue` makes the spec slower and just as flaky.

### Fix

Retry the interaction, not the assertion.

```
await expect(async () => {
  await page.locator('input[name="quietStart"]').fill("22:00");
  await page.locator('input[name="quietEnd"]').fill("07:00");
  await expect(page.locator('input[name="quietStart"]')).toHaveValue("22:00", {
    timeout: 1_000,
  });
  ...
}).toPass({ timeout: 20_000 });
```

The inner assertions have a short timeout on purpose: they are how the block
decides to fill again, not how it waits. A long inner timeout would spend the
outer budget waiting for a value that is never coming back.

Landed in `364a6b8` (P6-G24c), 9 September 2026.

## Spec two: the session stage rail

### Cause

Two causes, and only fixing both settles it.

**A running session holds an event stream and refreshes on every event.** The
page calls `router.refresh()` when the stream delivers, so the rail's buttons
are detached and re-created underneath a click. Playwright reported "element is
not stable", then "element was detached from the DOM", depending on where in
the refresh the click landed.

`networkidle` is no help here and never will be: an open event stream never
goes idle. A spec waiting for it waits for the whole timeout and then proceeds
anyway.

**"Continue is not visible" means two different things.** It is true at the end
of the rail, and it is true while a click's navigation is still settling. An
earlier version of the loop broke out whenever Continue was not visible within
three seconds, so it stopped mid-rail about one run in three and the close
button it then waited for never appeared. The failure surfaced as a timeout on
the click, several stages away from the decision that caused it.

### Fix

Both halves, in the same loop.

```
for (let i = 0; i < WEEKLY_STAGE_COUNT * 3; i += 1) {
  if (await closeBtn.isVisible().catch(() => false)) break;
  if (!(await continueBtn.isVisible().catch(() => false))) {
    await page.waitForTimeout(500);   // mid-refresh: a third state
    continue;
  }
  await expect(async () => {
    await continueBtn.click({ timeout: 4_000 });
  }).toPass({ timeout: 12_000 });
}
```

Waiting for *either* button distinguishes the two meanings: Continue means keep
going, Close means the rail is done, neither means wait. The click is retried
against whatever node is current rather than against the handle the loop
started with.

The 4-second inner timeout is deliberate and is the shortest in the suite. It
is how long the block waits before deciding the node it has is stale and asking
for a fresh one; the 12-second outer budget is the real patience.

Landed in `364a6b8` (P6-G24c), 9 September 2026.

## Spec three: the command palette, found by the report itself

Not one of the two this task was opened for. It turned up on run six of ten, in
the flakiness report added here, which is the whole argument for adding it.

### Cause

`e2e/s32-search.spec.ts` presses `ControlOrMeta+k` immediately after
navigating. The shortcut is registered by a client component at hydration, so a
keypress before that is delivered to the document and discarded. Nothing is
listening, nothing opens, and the assertion afterwards spends ten seconds
waiting for a palette that was never asked for.

Exactly the quiet-hours cause in a different costume: a race lost at the moment
of the interaction.

### Fix

`openPalette()` retries the keystroke, with a short inner timeout that is how
it decides to press again rather than how it waits.

```
async function openPalette() {
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByTestId("palette")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}
```

All three presses in the file go through it.

**Before the report existed this was invisible.** Continuous integration
retries once, the retry passes, the run is green, and nobody learns. It had
presumably been failing at this rate for as long as the spec has existed.

## The third fix, which is why neither returns

`e2e/fixtures.ts` exports the suite's own `test` and `expect`. That `expect`
wraps every locator matcher so the document settles before the question is
asked, and all the specs import from there rather than from `@playwright/test`.

This matters more than either fix above, because it is the one a person writing
the next spec inherits without knowing the file exists. A convention nobody is
told about is a convention that lapses.

## Evidence

The test plan asks for ten consecutive runs with neither spec failing, and the
flakiness report as the record.

**What was run:** the full end-to-end suite, ten times, on this machine,
against a local Postgres, after a fresh build with the standalone links
repaired first. Each run kept its own flakiness report.

| Runs | Result |
|---|---|
| 1 to 5 | 319 passed, report empty |
| 6 | 316 passed, 1 failed: the command palette, above. 2 did not run behind it |
| 7 to 10 | 319 passed, report empty, with the palette fix in place |

**Neither spec this task names appeared in any of the ten reports.** That is
the acceptance criterion, and it is met.

**The palette fix has four clean runs behind it, not ten**, because it was
written between run six and run seven. Saying ten would be claiming evidence
that does not exist.

**One run at a time, and it took two false starts to respect that.** CLAUDE.md
says never to run two Vitest suites at once against the same Postgres, because
the harness drops a database the other is using. The browser suite has the same
constraint and the same line does not mention it. A first attempt at these ten
runs was stopped part-way, its shell survived the stop, and it kept starting
runs underneath the run that replaced it. Two suites then shared
`openokr_e2e`, and the result read as a regression: a SCIM POST answered 200
instead of 201 because the other run had already created the person, a goal a
spec had just written was not on the page, and several sign-ins passed ten
seconds. None of it was real. The suite was 319 passing before and 319 passing
after, on the same commit.

That is worth more than the ten runs it delayed. **Two end-to-end runs at once
produce failures that look exactly like product defects**, and nothing in the
harness says so. Anybody running this suite in a loop should check for a
leftover server on 3210 and 3211 first.

**What this evidence is not.** Ten green runs cannot prove a race is gone; they
raise the confidence that it is rare. The argument that it is *fixed* is the
one above: each cause is named, and each fix addresses the named cause rather
than widening a timeout until the symptom stops. A fix that only moved a number
would deserve less trust after ten runs than these do after one.

**Neither spec is quarantined.** `test-quarantine.json` is empty and stays
empty. A quarantine entry is a debt with a sentence saying when it comes out
again, and neither of these needs one: both have a fix, not a suppression.

## What to do if either comes back

Do not raise a timeout. Both causes above are races, and a longer timeout
changes how often a race is lost rather than whether it is run.

Ask which of the three states the page was in when it failed. The trace has
that: Playwright records the DOM at the moment of the failure, and the
difference between "hydrating", "mid-refresh" and "at the end of the rail" is
visible in it.
