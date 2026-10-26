# @openokr/db

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.3.1

## 0.3.0

### Patch Changes

- [#122](https://github.com/open-okr/open-okr/pull/122) [`37a1fdc`](https://github.com/open-okr/open-okr/commit/37a1fdc1cbb3369deefc3985cc31e82ec40f5276) Thanks [@agungksidik](https://github.com/agungksidik)! - The account the setup wizard creates is verified, so an instance with mail
  configured before its first run no longer locks its operator out.
  
  With mail configured, a verified address is required to sign in, and the
  wizard's account was created unverified: finishing setup failed, and every
  later sign-in was refused with the same words as a wrong password. The first
  account is now created verified and signed in straight away. The data-change
  `0025_verify_first_account` verifies the earliest account on an existing
  instance (run `pnpm db:change`). A correct password on an unverified address
  now says to open the confirmation link instead of "Those details did not
  match".

- [#122](https://github.com/open-okr/open-okr/pull/122) [`760b0a7`](https://github.com/open-okr/open-okr/commit/760b0a7d5cd65266688d9770afaf87394894bd0b) Thanks [@agungksidik](https://github.com/agungksidik)! - A KPI's healthy and watch thresholds follow the workspace unless the KPI sets
  its own, so moving them on Rhythm recolours existing KPIs.
  
  Each KPI used to copy the workspace's thresholds when it was created, so a
  change on /admin/rhythm reached only KPIs created afterwards. Migration 0139
  makes both columns optional, where empty means the workspace's current value,
  and changing either threshold recomputes every KPI that follows it. A KPI
  given its own line through `kpis.update` keeps it; sending null returns it to
  the workspace. Run `pnpm db:change` after upgrading: data change
  `0026_kpi_corridor_follows_workspace` clears every stored line that equals
  the workspace's current one or the canon's 90 and 70, and rereads the band
  of each KPI judged on the ratio.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`04bddd1`](https://github.com/open-okr/open-okr/commit/04bddd137037b8427c32c6af5248c6114f7eda9c) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A weekly session's note for leadership is written with the editor.
  
  The coordinator's note can carry bold, lists and links. The digest, its
  narration and a post to the space's channel still carry it as one line
  after "For leadership:". Migration 0142 adds a document column beside it,
  and data change 0031 (`pnpm db:change`) turns every note written before
  into a document with the same paragraphs; until it runs, each reads exactly
  as before.
  
  For this release the note is written twice, the document and its plain
  text, so the release before still reads it during an upgrade.
  `sessions.setCoordinatorNote` takes editor JSON, and still takes plain
  text, which is wrapped as a document; `sessions.digest` returns
  `noteDocument` beside the plain `note`. The plain column, and the plain
  text input, go a release later. `RichTextField` takes `hideLabel`, for a
  field a heading beside it already names.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`0020453`](https://github.com/open-okr/open-okr/commit/0020453719e5ac8bf330e4d185f9f7e46322be81) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A monthly review's shifts note and its decisions are written with the editor.
  
  The resource or priority shifts and each decision can carry bold, lists and
  links, and a decision shows as written on the review, the goal page and the
  cycle page. Migration 0140 adds a document column beside each, and data
  changes 0027 and 0028 (`pnpm db:change`) turn every note and decision
  written before into a document with the same paragraphs; until they run,
  each reads exactly as before.
  
  For this release both are written, the document and its plain text, so the
  release before still reads them during an upgrade. `sessions.setShifts` and
  `sessions.recordDecision` take editor JSON, and still take plain text, which
  is wrapped as a document; the read actions return `shiftsDocument` and each
  decision's `textDocument` beside the plain text. The plain columns, and the
  plain text input, go a release later.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`376b799`](https://github.com/open-okr/open-okr/commit/376b799a9ff7223868645d8050cc9fc233b60d7c) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A quarterly review's management retro answers and the facilitator's private
  stage notes are written with the editor.
  
  Each answer and each note can carry bold, lists and links, and an answer
  shows as written on the review. The minutes still give each answer on one
  line. Migration 0141 adds a document column beside each answer, and data
  changes 0029 and 0030 (`pnpm db:change`) turn every answer and stage note
  written before into a document with the same paragraphs; until they run,
  each reads exactly as before.
  
  For this release an answer is written twice, the document and its plain
  text, so the release before still reads it during an upgrade. A stage note
  lives in a map with no second column, so the release before shows a note
  written in this one as empty; the facilitator alone reads it.
  `sessions.setManagementAnswer` and `sessions.setStageNote` take editor JSON,
  and still take plain text, which is wrapped as a document;
  `sessions.managementRetro` returns each answer's `bodyDocument` beside the
  plain text, and `sessions.read` returns each stage note as a document. The
  plain column, and the plain text input, go a release later.

- [#120](https://github.com/open-okr/open-okr/pull/120) [`832595b`](https://github.com/open-okr/open-okr/commit/832595bf39d5f4996567a3bb7d1813a4fec34a32) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - A quarter's revalidation notes, what changed and the focus areas, are
  written with the editor.
  
  Both notes can carry bold, lists and links. A member who cannot edit the
  cycle sees them as written rather than as a form they cannot submit.
  Migration 0143 adds a document column beside each, and data change 0032
  (`pnpm db:change`) turns every note written before into a document with
  the same paragraphs; until it runs, each reads exactly as before.
  
  For this release each note is written twice, the document and its plain
  text, so the release before still reads it during an upgrade.
  `workflow.setRevalidation` takes editor JSON, and still takes plain text,
  which is wrapped as a document; `workflow.read` returns
  `revalidationDocuments` beside the plain `revalidation`. The plain columns,
  and the plain text input, go a release later.
- Updated dependencies []:
  - @openokr/config@0.3.0

## 0.2.0

### Minor Changes

- [#110](https://github.com/open-okr/open-okr/pull/110) [`fecd1c1`](https://github.com/open-okr/open-okr/commit/fecd1c18556e938627c4f5094b22a751297aedca) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Stage 9 of the quarterly review is "Keep, modify, abandon or defer"
  (METHOD.md §8.8). An objective now closes as one of five decisions:
  achieved, keep, modify, defer or abandon, each with its meaning on the
  screen. An unfinished aspirational objective shows "Proposed: Keep" where
  the workspace carries forward, and the room still chooses.
  
  A deferred objective is fed forward to the next cycle's issue list when the
  cycle is archived, at the carry-forward impact, once.
  
  Migration 0136 widens the close decision on goals and on review decisions.
  Every stored decision stays valid.

- [#110](https://github.com/open-okr/open-okr/pull/110) [`bf256ef`](https://github.com/open-okr/open-okr/commit/bf256eff36f8e8b601559bc381c624b2fa2ad9eb) Thanks [@akmalakhpah](https://github.com/akmalakhpah)! - Closing a cycle carries every kept or modified objective into the next one
  as a draft (METHOD.md §8.9). Each key result starts from the last value it
  recorded, with the same target. A milestone already done stays behind, and
  a measured baseline comes back as a metric with its target to set. The
  draft is an ordinary objective: it passes Phase 4's checks and Phase 5's
  gates like any other, and one somebody deletes stays deleted. An objective
  whose champion has left is named on the closed cycle instead of carried.
  
  A deferred objective reaches the issue list whether it was deferred at the
  review or from its own page, whichever was decided later. The lowest
  process-health statement is now called the next cycle's improvement action
  in phase 3.
  
  Stage 10 of the quarterly review is "Learnings". The minutes report the
  committed key results met apart from the cycle score, on the screen and in
  both exports.
  
  Migration 0137 adds `goals.carried_from_goal_id`, nullable, with a unique
  index per cycle. `cycles.feedForward` and `cycles.close` report `drafts`
  and `notCarried`, and `workflow.read`'s closure reports `carriedDrafts` and
  `notCarried`. `sessions.minutes` reports `summary.committed`.

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.2.0

## 0.1.2

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.1.1

## 0.1.0

### Patch Changes

- Updated dependencies []:
  - @openokr/config@0.1.0
