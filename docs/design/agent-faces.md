# Agent faces

The face an agent wears wherever it speaks or is listed. Requested by the
product owner on 3 November 2026, from the agent set the project site draws.
Authority: UIUX-PLAN.md §2 (Colour, Icons, Motion), AI-NATIVE-PLAN.md §6.1
("an agent has a name, an avatar and a profile").

## 0. What already exists

| Component | Where | What it gives this change |
|---|---|---|
| An agent's stored kind, `coach`, `champion` or `custom` | `agents.kind`, read by `agents.list` | Which face an agent row wears, without matching on a name an admin can edit |
| The trigger catalogue, with each trigger's owner | `packages/method/src/triggers.ts` | Which agent sent a nudge, from the rule key the row already carries |
| The theme tokens, repainted under `data-theme` | `packages/ui/src/styles/tokens.css` | Eyes that follow light and dark |

**What did not exist.** No agent had a face. The navigation drew Lucide's
`Bot`, the copilot a speech bubble, and a nudge only a chip.

## 1. Three faces

| Face | Who | Ink | Eyes |
|---|---|---|---|
| General | The copilot, and any custom agent | `currentColor`: the text around it | `--surface` |
| Coach | The OKR Coach | `#3A80ED` in both themes | White |
| Champion | The OKR Champion | `#27A959` in both themes | White |

`agentFaceKind(kind)` maps a stored kind to a face, and anything that is not
the Coach or the Champion wears the general one. It lives in
`agent-face-kinds.ts` with the kind and mood lists, apart from the component:
the face is a client component, and a server page cannot call a function
exported from a `"use client"` module.

**Drawn inline, not loaded as a file.** An `<img>` of an SVG sees the
operating system's colour scheme and never the product's own theme switch.
Inline, the general face's ink and eyes are a token and the text colour, so a
reader who picks dark on a light system gets a light face with dark eyes, the
same inversion the source drawings make. It also takes a navigation row's
hover and active colour the way a Lucide icon does.

**Green and blue are exemptions, not a new status.** UIUX-PLAN.md §2 rule 1
keeps green for "on track". The Champion's green is an identity colour, like
the avatar palette, and the face's shape and its mood carry what it means. See
[colour-system.md](colour-system.md), "The agent face exemption".

## 2. Six moods

| Mood | Still pose | When it plays | Length |
|---|---|---|---|
| `idle` | Open eyes | Glances left and right; blinks for about 0.18 s | Always: the glance on a 6 s loop, the blink every 4.6 s |
| `thinking` | Open eyes | Eyes rise and fall a beat apart | 1.1 s, three times; loops while live |
| `happy` | Eyes smiling (lower lids) | Two hops, eyes bouncing | 2.4 s, twice |
| `sad` | Lids tilted down | Head and eyes droop, one slow blink | 4.4 s, once |
| `surprised` | Eyes wide | Squeeze, pop, wobble, stay wide | 2.7 s, once |
| `sleeping` | Eyes shut to a slit | One breath | 4.8 s, once |

The geometry and timings are the source drawings'. Two keyframes are adapted:

| Keyframe | Change | Why |
|---|---|---|
| `af-swell`, `af-pop` | The first 80 percent of the drawing's 3.4 s loop | The loop closes the eyes again before repeating. A face that plays once should end wide-eyed, not jump there |
| `af-ponder` | The wave from rest and back to rest | The drawing's wave starts and ends with the eyes raised. `af-wave`, unchanged, is what loops while live |

## 3. Motion

UIUX-PLAN.md §2 allows motion on hover, focus and state change, keeps first
paint to half a second, and reserves ambient motion for live meaning. Idle is
the one exception, decided by the product owner on 3 November 2026 and
written into §2.

| A face plays | Because |
|---|---|
| Always, when idle | The drawing's own loop. The blink and the glance run on different periods, so a blink lands at a different moment of the glance each time. Each face starts at its own point in the loop (`--af-phase`, from its id), so a list of idle faces does not blink in unison |
| When its mood changes after it appeared, once | A state change. A change to `idle` starts its loop rather than a play |
| When the link, button, list row or `.group` around it is hovered, or the link or button is focused | Hover and focus |
| Continuously, with `live` | The agent is working right now. Used for a running run and an answer on its way |
| Never on first paint, except idle | A list of twenty runs hopping as the page loads is the motion §2 rules out |

**WCAG 2.2.2.** Motion that starts on its own and lasts over five seconds
should have a way to stop it. Reduced motion stops every face, idle
included; the product has no per-page control of its own, so a reader whose
system does not ask for reduced motion has none. A setting to still the faces
is the follow-up if that is wanted.

**Reduced motion.** Every rule that starts an animation sits inside
`prefers-reduced-motion: no-preference`, so a reader who asked for less sees
each mood's still pose. The global rule in `tokens.css` would otherwise play
each animation for one frame and park the face on its last one.

**Why a style sheet.** The content security policy refuses an inline
`<style>` without a nonce, which is where the drawings kept their keyframes.
They are in `packages/ui/src/styles/agent-face.css`, imported by `globals.css`.

## 4. Where each face is

| Screen | Face | Mood |
|---|---|---|
| Admin navigation, "Agents and runs" | General | `idle` |
| S-36 Agents, each agent | Its kind | `idle`, or `sleeping` when switched off |
| S-36 Agents, each run | Its agent's kind | `moodForRun`: running or planning `thinking` and live; completed `happy`, or `idle` with nothing logged; cancelled `sleeping`; failed `sad` |
| S-39 Copilot, the top bar trigger | General | `idle` |
| S-39 Copilot, panel header | General | `sleeping` with AI off, `thinking` while answering, `sad` after a problem, else `idle` |
| S-39 Copilot, "Reading your workspace" | General | `thinking`, live |
| S-03 Inbox, a nudge row | The rule's owner | `faceForTrigger`, below |
| Method, a trigger's page | The rule's owner | `faceForTrigger` |
| Goal page, "What the Coach sees" | Coach | `thinking`; live while a fix is drafted; `happy` when the suggestion passes the catalogue; `sad` when the assist fails |
| S-09 Draft Coach | Coach | The worst verdict: fail `sad`, warn `thinking`, all pass `happy` |
| Alignment panel, Review tab | Coach | A finding: high `surprised`, else `thinking`. Empty: `idle` |
| S-07 Strategic issues, "Proposed by the Coach" | Coach | `thinking` |

**A halt is asleep, not sad.** The Champion's cost cap stops a run without
failing it, and a face grieving over a limit the workspace chose would teach
people to ignore the one for a real failure.

### Nudges

`apps/web/lib/agent-moods.ts` holds one mood per trigger key, typed
`satisfies Record<TriggerKey, AgentMood>`, so a trigger added to the method
package without a mood fails the typecheck. The rule of thumb:

| Mood | Triggers like |
|---|---|
| `idle` | A routine reminder: `checkin.due`, `ack.owed`, `kpi.watch` |
| `thinking` | A question or a proposal: most `quality.*`, `kpi.recovery_proposed` |
| `happy` | Good news: `cycle.starts`, `session.open`, `kpi.recovered`, `digest.weekly` |
| `sad` | Missed or late: `checkin.overdue`, `session.missed`, `cycle.closing` |
| `surprised` | Changed, and wants attention now: `confidence.critical`, `kpi.unhealthy`, `quality.conflict` |

**Presentation, not practice.** The mood decides nothing. Which rule fires,
when and for whom is METHOD.md's, and a nudge reads the same with every face
drawn still.

**The reference mockups are done** (plan 0.9.0 G6). Every agent that `docs/mockups/src` drew as the gradient `.av.bot` circle is now the face, one `.af` rule in `style.css` per kind (`coach`, `champion`, `agent`) showing the still idle pose. The PNGs are re-rendered by the lead.

## 5. Not yet

| Surface | Why it waits |
|---|---|
| People list and profile, for an agent member | `people.directory` and `people.readMember` say a member is an agent, not which one. Adding the kind changes a public read and the API contract |
| Proposal rows on S-36 and the review inbox | A proposal names its run, and a run older than the twenty listed has no agent to look up. Same fix: carry the agent's kind on the read |

## 6. Acceptance criteria

- **Given** the seeded workspace, **when** an administrator opens Agents and
  runs, **then** the OKR Coach's row shows the blue face, the OKR Champion's
  the green one, and a custom agent the general one.
- **Given** the dark theme chosen on a light system, **when** the general face
  is drawn, **then** its eyes are the dark `--surface` and its ink the light
  text colour.
- **Given** a run that was cancelled, **when** its row is drawn, **then** its
  face is asleep.
- **Given** a nudge for `checkin.overdue`, **when** it is listed in the inbox,
  **then** it wears the Champion's face, sad.
- **Given** a draft whose checks all pass after an edit, **when** the verdict
  changes, **then** the Coach's face plays happy once and rests.
- **Given** an idle face and nobody hovering, **when** it is on screen,
  **then** each eye glances on a six-second loop and blinks on a separate
  4.6-second one.
- **Given** a reader with reduced motion, **when** any face is drawn,
  **then** it shows its mood's still pose and nothing moves.
