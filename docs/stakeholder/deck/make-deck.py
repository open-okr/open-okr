#!/usr/bin/env python3
"""Build OpenOKR-Deck.pptx from the same content as the Word overview.

Slides are laid out by hand in points on a 960 x 540 canvas, using the same
design tokens as the interface mockups. Run: python3 make-deck.py
"""
import os

import pptx
from pptx import Slide, W, H

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, os.pardir, 'mockups', 'png')

BRAND, BRAND_DARK, BRAND_600 = '4F46E5', '1E1B4B', '4338CA'
BRAND_WEAK, BRAND_LINE = 'EEF2FF', 'C7D2FE'
INK, INK2, INK3, INK4 = '0F172A', '334155', '64748B', '94A3B8'
BG, WHITE, LINE = 'F8FAFC', 'FFFFFF', 'E2E8F0'
OK, OKBG = '15803D', 'DCFCE7'
WARN, WARNBG = 'B45309', 'FEF3C7'
BAD, BADBG = 'B91C1C', 'FEE2E2'

M = 56.0                 # side margin
CW = W - 2 * M           # content width, 848pt

deck = []
section = ['']


def shot(name):
    return os.path.join(SHOTS, name + '.png')


def para(text, size=14, color=INK2, **kwargs):
    out = {'text': text, 'size': size, 'color': color}
    out.update(kwargs)
    return out


def new(bg=WHITE, label=None):
    slide = Slide()
    slide.rect(0, 0, W, H, fill=bg)
    if label is not None:
        section[0] = label
    deck.append(slide)
    return slide


def chrome(slide, rule=True):
    """Footer: a hairline, the section label, and the slide number."""
    number = len(deck)
    if rule:
        slide.rect(M, 502, CW, 0.75, fill=LINE)
    slide.text(M, 512, CW - 40, 16,
               [para(section[0].upper(), 8.5, INK4, spacing=1.1, bold=True)])
    slide.text(W - M - 40, 512, 40, 16,
               [para(str(number), 9, INK4, align='r', bold=True)])


def heading(slide, title, kicker=None, sub=None):
    y = 44.0
    if kicker:
        slide.text(M, y, CW, 14,
                   [para(kicker.upper(), 9, BRAND_600, bold=True, spacing=1.2)])
        y += 17
    slide.text(M, y, CW, 40,
               [para(title, 29, BRAND_DARK, bold=True, face='Calibri Light')])
    y += 40
    if sub:
        slide.text(M, y, CW - 60, 34, [para(sub, 13.5, INK3, line=124)])
        y += 30
    return y + 16


def card(slide, x, y, w, h, title, body, accent=BRAND, fill=WHITE,
         title_size=14, body_size=12, tag=None):
    slide.rect(x, y, w, h, fill=fill, line=LINE, radius=8, shadow=True)
    slide.rect(x, y, 3.5, h, fill=accent, radius=1.6)
    ty = y + 15
    if tag:
        slide.text(x + 18, ty, w - 34, 12,
                   [para(tag.upper(), 8.5, accent, bold=True, spacing=1.1)])
        ty += 15
    slide.text(x + 18, ty, w - 34, 22, [para(title, title_size, INK, bold=True)])
    ty += title_size * 1.5 + 5
    slide.text(x + 18, ty, w - 34, h - (ty - y) - 14,
               [para(body, body_size, INK2, line=126)])


def stat(slide, x, y, w, value, label, color=BRAND_600):
    slide.text(x, y, w, 40, [para(value, 32, color, bold=True,
                                  face='Calibri Light', align='ctr')])
    slide.text(x, y + 42, w, 30, [para(label, 10.5, INK3, align='ctr', line=118)])


def picture_slide(name, title, caption, kicker=None):
    slide = new(BG)
    slide.text(M, 38, CW, 26, [para(title, 21, BRAND_DARK, bold=True,
                                    face='Calibri Light')])
    if kicker:
        slide.text(W - M - 220, 42, 220, 16,
                   [para(kicker.upper(), 8.5, BRAND_600, bold=True,
                         spacing=1.1, align='r')])
    slide.text(M, 68, CW, 30, [para(caption, 11.5, INK3, line=122)])
    slide.fit_picture(shot(name), 36, 100, 888, 396)
    chrome(slide, rule=False)
    return slide


def divider(number, title, blurb, label):
    slide = new(BRAND_DARK, label=label)
    slide.rect(0, 0, W, H, gradient=(BRAND_DARK, '312E81', 45))
    slide.rect(0, 0, 6, H, fill=BRAND)
    slide.text(M + 30, 196, 120, 60,
               [para(number, 62, BRAND, bold=True, face='Calibri Light')])
    slide.text(M + 30, 268, 700, 56,
               [para(title, 40, WHITE, bold=True, face='Calibri Light')])
    slide.text(M + 30, 330, 620, 40, [para(blurb, 14, BRAND_LINE, line=126)])
    slide.text(W - M - 40, 512, 40, 16,
               [para(str(len(deck)), 9, '6366F1', align='r', bold=True)])
    return slide


# ---------------------------------------------------------------- 1. title

s = new(BRAND_DARK, label='OpenOKR')
s.rect(0, 0, W, H, gradient=(BRAND_DARK, '3730A3', 40))
s.rect(0, 0, W, 4, fill=BRAND)
s.rect(M, 150, 46, 46, fill=BRAND, radius=11)
s.text(M, 163, 46, 26, [para('O', 22, WHITE, bold=True, align='ctr')])
s.text(M, 214, 800, 74,
       [para('OpenOKR', 62, WHITE, bold=True, face='Calibri Light')])
s.text(M, 296, 700, 30,
       [para('Your OKR coach, built in.', 22, BRAND_LINE, face='Calibri Light')])
s.rect(M, 344, 64, 3, fill=BRAND)
s.text(M, 364, 660, 54,
       [para('Open source, AI-native, self-hosted or in our cloud. The OKR method '
             'as executable rules, and two AI teammates that run the practice with you.',
             13, '9FA8DA', line=132)])
s.text(M, 468, 600, 18,
       [para('Product overview  ·  August 2026', 10.5, '7986CB', spacing=0.6)])

# ------------------------------------------------------- 2. opening statement

s = new(WHITE)
s.rect(0, 0, 6, H, fill=BRAND)
s.text(M + 24, 150, 800, 130,
       [para('Most organisations do not fail at OKRs because their '
             'software was bad.', 30, INK, bold=True, face='Calibri Light',
             line=124, after=14),
        para('They fail because the practice never happened.', 30, BRAND_600,
             bold=True, face='Calibri Light', line=124)])
s.text(M + 24, 330, 760, 70,
       [para('Somebody wrote objectives in a spreadsheet in January, nobody '
             'checked in by March, and the quarterly review was a meeting where '
             'everyone agreed things had gone reasonably well.', 15, INK3, line=134)])
chrome(s)

# -------------------------------------------------------------- 3. problem

s = new(BG)
y = heading(s, 'Three ways to run OKRs today, three ways to lose the practice',
            'The problem')
cw = (CW - 40) / 3
card(s, M, y, cw, 210, 'Spreadsheets',
     'No cadence, no accountability, no quality bar. Nobody is ever told '
     'anything. The file is opened twice a quarter.', accent=INK4, tag='What most start with')
card(s, M + cw + 20, y, cw, 210, 'Conventional OKR trackers',
     'A database with a progress bar. They store objectives faithfully and '
     'are entirely passive. They will happily hold a badly written key result '
     'for a whole quarter without comment.', accent=WARN, tag='What most buy')
card(s, M + 2 * (cw + 20), y, cw, 210, 'Consulting and training',
     'The method is real, but it walks out of the door with the consultant. '
     'There is nothing to enforce it on a wet Tuesday in week six.',
     accent=BAD, tag='What most fall back on')
s.text(M, y + 232, CW, 26,
       [para('The practice that makes OKRs work has been well understood for '
             'twenty years. It just does not live in the software.',
             14, INK2, italic=True)])
chrome(s)

# ------------------------------------------------------- 4. failure pattern

s = new(WHITE)
y = heading(s, 'The failure pattern is always the same', 'The problem')
left = [
    'Objectives are written as project plans.',
    'Key results measure activity instead of impact.',
    'Nothing has a baseline, so nothing can be scored.',
    'Teams commit to more than they can deliver, and never record what they cut.']
right = [
    'Check-ins stop by week five.',
    'Blockers sit unowned.',
    'The quarterly review becomes a presentation rather than a diagnosis.',
    'The next quarter starts from a blank page, as if nothing had been learned.']
for index, items in enumerate((left, right)):
    s.text(M + index * (CW / 2 + 10), y, CW / 2 - 20, 190,
           [para(text, 14, INK2, bullet='●', line=124, after=13)
            for text in items])
s.rect(M, y + 200, CW, 78, fill=BRAND_WEAK, line=BRAND_LINE, radius=8)
s.text(M + 24, y + 220, CW - 48, 46,
       [para('Every one of those is **a rule that could have been enforced**, '
             '**a question that could have been asked at the right moment**, and '
             '**a person who could have been told**. That is the product.',
             15, BRAND_600, line=128)])
chrome(s)

# ---------------------------------------------------------------- divider

divider('01', 'What OpenOKR is',
        'Two things make it different, and every design decision serves one of them.',
        'What OpenOKR is')

# ----------------------------------------------------------- 6. two differences

s = new(BG)
y = heading(s, 'The method is in the product, and the product is active',
            'What OpenOKR is')
cw = (CW - 24) / 2
card(s, M, y, cw, 250, 'The method is in the product',
     'The OKR practice canon is written as one authoritative specification and '
     'compiled into a pure library with no database, no network and no AI.\n\n'
     'It holds the eight-phase cycle, the scoring and confidence bands, twenty '
     'quality rules with their word lists and coaching prompts, six publish '
     'gates, the alignment arithmetic, the KPI corridors, the blocker and '
     'root-cause taxonomies, both session agendas, and the closing diagnostic.',
     accent=BRAND, tag='Difference one', title_size=16, body_size=12.5)
card(s, M + cw + 24, y, cw, 250, 'The product is active',
     'Two agent members ship with every workspace. They are members, not '
     'features: they have names, they appear in feeds, they can be mentioned, '
     'and they are accountable.\n\n'
     'They initiate, escalate and propose, in the browser, in Slack, Microsoft '
     'Teams, WhatsApp and Telegram, by email, and through whatever AI agent the '
     'user already runs.',
     accent='7C3AED', tag='Difference two', title_size=16, body_size=12.5)
chrome(s)

# ---------------------------------------------------- 7. the pure library

s = new(WHITE)
y = heading(s, 'One specification, compiled, running in four places at once',
            'The method is in the product',
            'Because the rule engine is pure, the same code checks a draft in the '
            'browser, refuses a bad write on the server, drives the agents, and '
            'validates imported data.')
places = [('In the browser', 'As the user types, on every keystroke'),
          ('On the server', 'Before any write is accepted'),
          ('Inside the agents', 'So a nudge cites the same rule a user sees'),
          ('In the importer', 'So migrated data is judged by the same bar')]
cw = (CW - 3 * 16) / 4
for index, (title, body) in enumerate(places):
    x = M + index * (cw + 16)
    s.rect(x, y, cw, 96, fill=BG, line=LINE, radius=8)
    s.text(x + 16, y + 20, cw - 32, 18, [para(title, 13, BRAND_600, bold=True)])
    s.text(x + 16, y + 42, cw - 32, 44, [para(body, 11.5, INK3, line=126)])
s.rect(M, y + 120, CW, 82, fill=BRAND_DARK, radius=8)
s.text(M + 24, y + 140, CW - 48, 46,
       [para('A conformance suite fails the build when the specification and the '
             'code disagree, so the product cannot drift away from the method. '
             'Every coaching message carries a rule key that resolves back to the '
             'specification, so a user can open the rule and argue with it.',
             13.5, BRAND_LINE, line=132)])
chrome(s)

# ------------------------------------------------------------- 8. the agents

s = new(BG)
y = heading(s, 'Two AI teammates, with names, scopes and accountability',
            'The product is active')
cw = (CW - 24) / 2
for index, (initials, colour, name, owns, does) in enumerate([
        ('C', BRAND, 'OKR Coach', 'Quality and practice',
         'Reviews every draft against the twenty rules. Runs a nightly semantic '
         'sweep for duplicated metrics, better parents and hidden dependencies.\n\n'
         'Speaks up when the not-doing list is empty, when nothing was cut at the '
         'capacity check, when a goal is reported on track but its key results '
         'have not moved in a month, and when the scores cluster suspiciously '
         'near perfect at the close.'),
        ('Ch', '0EA5E9', 'OKR Champion', 'Rhythm and momentum',
         'Reminds the champion before a check-in is due, on the day, and daily '
         'after. Escalates to the reviewer, the coordinator and then the sponsor, '
         'always visibly to the person being escalated past.\n\n'
         'Runs the blocker clock, opens and closes the weekly session, assembles '
         'the digest, keeps the streak, watches every KPI corridor, and drafts '
         'the recovery objective when one drops out of range.')]):
    x = M + index * (cw + 24)
    s.rect(x, y, cw, 268, fill=WHITE, line=LINE, radius=8, shadow=True)
    s.rect(x, y, 3.5, 268, fill=colour, radius=1.6)
    s.rect(x + 20, y + 20, 34, 34, fill=colour, radius=17)
    s.text(x + 20, y + 29, 34, 18, [para(initials, 13, WHITE, bold=True, align='ctr')])
    s.text(x + 64, y + 22, cw - 90, 20, [para(name, 16, INK, bold=True)])
    s.text(x + 64, y + 42, cw - 90, 16, [para(owns, 11, INK3)])
    s.text(x + 20, y + 74, cw - 40, 180, [para(does, 12, INK2, line=128)])
chrome(s)

# ------------------------------------------------------- 9. deterministic first

s = new(WHITE)
y = heading(s, 'It all still works with AI switched off', 'The product is active')
s.rect(M, y, CW, 96, fill=BRAND_WEAK, line=BRAND_LINE, radius=8)
s.text(M + 26, y + 24, CW - 52, 56,
       [para('The rules, nudges, escalations, gates, scores and the diagnostic '
             'are **deterministic code**, not prompts. AI adds drafting, rewriting, '
             'semantic judgement and natural language. **It never makes the decision.**',
             16, BRAND_600, line=130)])
y += 122
points = [
    ('Sellable where AI is not',
     'Regulated, air-gapped and AI-sceptical buyers get the whole practice. '
     'Continuous integration proves the product is whole with the provider off.'),
    ('Propose by default',
     'Every write an agent wants becomes a proposal in a human review queue. '
     'Direct writes need a narrow, explicit opt-in. Sandbox mode commits nothing.'),
    ('Capped and least-privilege',
     'Bindings on named spaces and goals only, never a workspace-wide grant. '
     'Every step metered, with a hard cost cap that halts a run mid-flight.')]
cw = (CW - 2 * 20) / 3
for index, (title, body) in enumerate(points):
    x = M + index * (cw + 20)
    s.text(x, y, cw, 20, [para(title, 14, INK, bold=True)])
    s.rect(x, y + 26, 28, 2.5, fill=BRAND)
    s.text(x, y + 40, cw, 90, [para(body, 12, INK2, line=128)])
chrome(s)

# ------------------------------------------------------------ 10. who it is for

s = new(BG)
y = heading(s, 'Who it is for', 'Nine readers, one product')
rows = [['Reader', 'What OpenOKR gives them'],
        ['Team member', 'One place, or one chat message, that says what they owe this week'],
        ['Champion', 'A composer that says why a key result is weak while it is being written'],
        ['Reviewer or manager', 'Every check-in from their people in one queue, one click to acknowledge'],
        ['Coordinator', 'A weekly session the product runs: confidence, blockers, commitments, digest'],
        ['Facilitator', 'A cycle that knows its phase, and a sixty-minute review with a timer'],
        ['Executive or sponsor', 'The organisation on one map, and escalations before things are unrecoverable'],
        ['OKR lead or PMO', 'Cycles across the organisation, KPI trees, alignment health, all exportable'],
        ['Administrator', 'Access, single sign-on, backups, a tamper-evident audit log, AI cost caps'],
        ['An external AI agent', "A consented sign-in, acting as its user, within their permissions, audited"]]
s.table(M, y, [200, CW - 200], rows, row_h=30, size=11.5)
s.text(M, y + 314, CW, 24,
       [para('**Organisations it fits:** companies of any size that want the practice and '
             'not just a database; universities, government and regulated sectors that must '
             'self-host; consultancies running the method for clients.', 12, INK3, line=126)])
chrome(s)

# ------------------------------------------------------------------ divider

divider('02', 'The product', 'What it actually looks like, screen by screen.',
        'The product')

# --------------------------------------------------------------- screenshots

picture_slide('01-work-map', 'The Work Map is the front door',
              'One company-wide tree. Every row carries the same contract: health, staleness, '
              'confidence, progress, champion and next step. An outdated badge overrides the last '
              'reported health, so nobody can hand-paint a goal green.', 'S-01')

picture_slide('02-cycle-workspace', 'A guided cycle that knows what is missing',
              'Eight phases with computed completion, never self-reported ticks. Here drafting is '
              'locked because three of the seven input pack items are missing, and the block names '
              'them. A planning session without inputs produces objectives written from opinion.',
              'S-04 / S-06')

s = new(WHITE)
y = heading(s, 'The eight phases, and the gate on each one', 'The guided cycle')
rows = [['Phase', 'What happens', 'The gate'],
        ['0. Annual strategy', 'Mission, vision, annual strategies and objectives, the not-doing list', 'The frame is agreed'],
        ['1. Prepare', 'Sponsor, facilitator, every session booked, the seven-item input pack', 'Drafting refused until the pack is complete'],
        ['2. Diagnose', 'Score the last cycle, read KPI baselines, rank five to ten issues', 'Prior cycle scored, or a first cycle declared'],
        ['3. Set direction', 'Three to five priorities with twelve-month success statements', 'The not-doing list is written'],
        ['4. Draft OKRs', 'Write objectives and key results, twenty rules checking live', 'Every key result passes its checks'],
        ['5. Align and commit', 'Map contribution, register dependencies, check capacity', 'All six publish gates green'],
        ['6. Run the cadence', 'Weekly check-ins, monthly reviews, the decision log', 'Sessions booked for the whole cycle'],
        ['7. Review and learn', 'Score, retro, diagnose, feed forward automatically', 'Every objective closed deliberately']]
s.table(M, y, [140, 400, CW - 540], rows, row_h=34, size=11)
chrome(s)

picture_slide('03-draft-coach', 'Twenty rules, running on every keystroke',
              'The failing objective shows its verdicts inline. One key result measures activity, '
              'another has no baseline, and the whole set has no leading indicator. The strength '
              'meter and quality panel update live. Warnings never block typing.', 'S-09')

s = new(BG)
y = heading(s, 'Coaching that is specific, and arguable', 'Quality at the point of writing')
s.fit_picture(shot('03b-rule-card'), M, y, 470, 236)
x = M + 494
s.text(x, y + 2, CW - 494, 18,
       [para('EVERY VERDICT OPENS INTO THE RULE', 9, BRAND_600, bold=True, spacing=1.1)])
s.text(x, y + 24, CW - 494, 60,
       [para('The coaching prompt, why it matters, a weak-versus-strong pair, and a '
             'rewrite the user applies or dismisses. Never a bare error string, and '
             'never a mysterious red dot.', 12.5, INK2, line=130)])
s.text(x, y + 96, CW - 494, 18,
       [para('SOME OF WHAT IT CATCHES', 9, BRAND_600, bold=True, spacing=1.1)])
catches = ['An objective starting with "launch". If we launch it and nothing changes, did we succeed?',
           'A key result with a target but no baseline. Without the "from", movement cannot be proved.',
           '"Hold twelve customer interviews." That is activity. What are they for? Measure that.',
           'Every key result lagging. You only find out at the end. Add a leading indicator.',
           'Average confidence above ninety percent at drafting. That is sandbagging, not a stretch.']
s.text(x, y + 118, CW - 494, 120,
       [para(text, 11.5, INK2, bullet='●', line=122, after=7) for text in catches])
chrome(s)

s = new(WHITE)
y = heading(s, 'Six publish gates, enforced server-side', 'Align and commit')
gates = [('1', 'Every objective has a title, a named champion and a named reviewer.'),
         ('2', 'Every key result passes its checks.'),
         ('3', 'Alignment is mapped. Each objective states what it contributes to.'),
         ('4', 'Every dependency is confirmed, or logged with a named risk owner.'),
         ('5', 'Capacity is checked, nothing is left exceeding, and the cuts are recorded.'),
         ('6', 'A publication date is set before day one of the cycle.')]
for index, (number, text) in enumerate(gates):
    gy = y + index * 40
    s.rect(M, gy, 26, 26, fill=BRAND_WEAK, radius=13)
    s.text(M, gy + 6, 26, 16, [para(number, 12, BRAND_600, bold=True, align='ctr')])
    s.text(M + 40, gy + 4, 520, 22, [para(text, 13.5, INK2)])
s.rect(M + 596, y, CW - 596, 246, fill=WARNBG, line='FCD34D', radius=8)
s.text(M + 620, y + 26, CW - 644, 24,
       [para('Gate five is the one nobody has had', 13.5, WARN, bold=True)])
s.text(M + 620, y + 56, CW - 644, 170,
       [para('Capacity is read from the initiatives actually planned against each key '
             'result, not self-declared.\n\n'
             'If one key result exceeds capacity and no cut is recorded, the cycle '
             'cannot be published.\n\n'
             '**A plan where nothing was cut is a plan that has not been made.** '
             'Without the gate, the cut happens in week six instead, without a decision.',
             12, WARN, line=130)])
chrome(s)

picture_slide('04-gates-capacity', 'The publish control states its reason, never sits silently inert',
              'Two gates are red. Capacity exceeds on one key result with nothing recorded as cut, '
              'and a dependency on Finance is unconfirmed. The Coach names the consequence rather '
              'than just the rule.', 'S-10')

picture_slide('05-alignment-studio', 'Alignment is contribution, not copying',
              'Solid connectors are contribution, dashed are dependencies both teams know about. '
              'The orphan goal is flagged, the health score names every gap with its penalty, and '
              'the Coach adds what structure alone cannot see.', 'S-16')

picture_slide('06-kpi-recovery', 'When a KPI leaves its corridor, the product drafts the fix',
              'Net revenue retention sits at seventy-one percent of target, below the ninety percent '
              'floor. The recovery objective was drafted from its own leading drivers and is half '
              'complete, so effective health reads seventy-nine: the fix is visible before the '
              'lagging number catches up.', 'S-18 / S-19')

picture_slide('07-weekly-session', 'Fifteen minutes, four steps, run by the product',
              'Team votes reveal together so nobody anchors on the champion. Every low score becomes '
              'a typed blocker with a named owner and one action inside twenty-four hours. Last '
              "week's commitments close honestly, including the one that did not land.", 'S-22')

picture_slide('08-quarterly-review', 'Sixty minutes, eleven timed stages, one honest diagnosis',
              'Scores stay hidden until the room reveals them together. Every key result below 0.7 '
              'gets exactly one cause. Five process-health statements are scored anonymously, and '
              "the lowest becomes next quarter's process priority.", 'S-24')

s = new(BG)
y = heading(s, 'The diagnostic is the most valuable output of the quarter',
            'Review and learn',
            'It reads the cycle score against the rhythm score and returns a verdict with a '
            'prescription. Computed from the workspace\'s own data, and the same answer with AI off.')
rows = [['The situation', 'What it means', 'What to do about it'],
        ['Cycle score 0.7 or above', 'Results delivered',
         'The question is not effort. It is whether the ambition was set high enough to be worth the quarter'],
        ['Below 0.7, rhythm strong', 'A strategy or OKR-quality problem',
         'The team ran the practice and still missed. Fix the key results, not the people'],
        ['Below 0.7, rhythm weak', 'A cadence problem',
         'Restore the weekly check-in before rewriting a single objective']]
s.table(M, y, [210, 230, CW - 440], rows, row_h=48, size=12)
s.text(M, y + 216, CW, 24,
       [para('That is the single question every executive asks at the close, and the one '
             'no tracker answers.', 13.5, INK2, italic=True)])
chrome(s)

picture_slide('09-channels', 'A coach that only lives in a browser tab is not active',
              'Every channel is two-way: nudges out, and real work in. A fully conversational '
              'WhatsApp check-in captures a typed blocker and its owner. Every message names the '
              'rule that sent it and where it sits on the escalation ladder.', 'Channels')

picture_slide('10-review-inbox', 'Notifications say what happened. This says what you owe.',
              'Server-computed, overdue first, driving a live badge. Agent proposals queue here too. '
              'A snooze quietens the message and never hides the obligation.', 'S-02')

# ------------------------------------------------------------------ divider

divider('03', 'Why it wins', 'What no other OKR tool does, and what each of you gets.',
        'Why it wins')

# ------------------------------------------------------- 5 differentiators

s = new(WHITE)
y = heading(s, 'Five things no other OKR tool does', 'Why it wins')
items = [
    ('The method is executable, not documentation',
     'Competitors ship templates and help articles. We ship rules that run on every '
     'keystroke and refuse a bad publish. A customer cannot quietly stop doing the practice.'),
    ('The software initiates',
     'Every other tool waits to be visited. Ours arrives in Slack on Friday morning, '
     'escalates the blocker that aged past its clock, and tells the sponsor early.'),
    ('It works with AI switched off',
     'The deterministic core makes it sellable into regulated, air-gapped and AI-sceptical '
     'buyers who would reject an LLM-dependent product outright.'),
    ('It diagnoses, not just reports',
     'At the close it says whether a missed quarter was a cadence problem or a strategy '
     'problem. Every executive asks that. No tracker answers it.'),
    ('Agent-native to the core',
     "Everything a human can do, an agent can do, through one permission-checked contract. "
     "The customer's own Claude or ChatGPT is a first-class user, not a scraping workaround.")]
for index, (title, body) in enumerate(items):
    ry = y + index * 62
    s.rect(M, ry, 26, 26, fill=BRAND, radius=13)
    s.text(M, ry + 6, 26, 16,
           [para(str(index + 1), 12, WHITE, bold=True, align='ctr')])
    s.text(M + 42, ry + 1, CW - 42, 20, [para(title, 14, INK, bold=True)])
    s.text(M + 42, ry + 23, CW - 60, 34, [para(body, 12, INK3, line=124)])
chrome(s)

# ------------------------------------------------------- what each gets

s = new(BG)
y = heading(s, 'What each of you gets', 'Why it wins')
cw = (CW - 2 * 18) / 3
audiences = [
    ('A methodology institute', BRAND,
     'The practice becomes enforceable after the engagement ends.\n\n'
     'Every rule, band, corridor, taxonomy and agenda lives in one versioned, '
     'auditable specification, separable from the code. Coaching prompts and rule '
     'names are translatable strings.\n\n'
     'You can see exactly what the product teaches, and disagree with it in a '
     'specific place rather than in general.'),
    ('An investor', '7C3AED',
     'A category with real budget, sold today mostly as passive databases.\n\n'
     'Open source removes funnel cost and makes the enterprise security review a '
     'non-event. AGPL blocks a hyperscaler reselling it. The cloud sells operation, '
     'so there is one product, one release and no feature-gate resentment.\n\n'
     'The agent layer is the moat: accumulated method, not a copyable prompt.'),
    ('An early customer', '0EA5E9',
     'Setup to first check-in in under fifteen minutes.\n\n'
     'Data on your own servers, in your own country, with no seat limit and no '
     'feature gate. Existing goals import from a spreadsheet with an AI-assisted '
     'mapper and a dry run.\n\n'
     'The whole workspace exports whenever you want. Nothing creates lock-in, which '
     'is exactly why it is easy to say yes to.')]
for index, (title, colour, body) in enumerate(audiences):
    x = M + index * (cw + 18)
    s.rect(x, y, cw, 268, fill=WHITE, line=LINE, radius=8, shadow=True)
    s.rect(x, y, cw, 3.5, fill=colour)
    s.text(x + 20, y + 22, cw - 40, 22, [para(title, 15, INK, bold=True)])
    s.text(x + 20, y + 52, cw - 40, 200, [para(body, 11.5, INK2, line=128)])
chrome(s)

# ------------------------------------------------------------- outcomes

s = new(WHITE)
y = heading(s, 'The outcomes we are designing for', 'Why it wins',
            'Leading indicators, instrumented in the product from day one.')
metrics = [('< 15 min', 'From install to first\npublished check-in'),
           ('70%+', 'Of due check-ins\nsubmitted on time'),
           ('> 75%', 'Median OKR strength\nscore at publication'),
           ('< 24 h', 'Median blocker logged\nto next action taken'),
           ('6+ weeks', 'Rhythm streak in half\nor more of active spaces')]
cw = (CW - 4 * 16) / 5
for index, (value, label) in enumerate(metrics):
    x = M + index * (cw + 16)
    s.rect(x, y, cw, 150, fill=BG, line=LINE, radius=8)
    stat(s, x, y + 30, cw, value, label.replace('\n', ' '))
s.text(M, y + 176, CW, 24,
       [para('Lagging: active instances after six months, organisations completing a full '
             'cycle end to end, and organisations running an agent unattended every week.',
             12.5, INK3)])
chrome(s)

# ------------------------------------------------------------------ divider

divider('04', 'The business', 'Scope, licence, status, and what we are asking for.',
        'The business')

# ------------------------------------------------------ module inventory

s = new(BG)
y = heading(s, 'Everything in version one, across six pillars', 'Scope',
            'Nothing is gated behind a paid tier. Self-host gets every capability, with no seat limit.')
pillars = [
    ('A', 'The OKR core',
     'Cycles and the guided workflow · goals and direction-aware key results · alignment '
     'with dependencies and the health score · KPIs, driver trees and formulas · health '
     'corridors and recovery OKRs · check-ins with snapshots and team voting · scorecard'),
    ('B', 'The rhythm',
     'Weekly check-in session · the five-type blocker taxonomy on a 24-hour clock · '
     'commitments · monthly review and decision log · the eleven-stage quarterly review · '
     'mid-cycle calibration · cadence and staleness · the review inbox and digests'),
    ('C', 'The work',
     'Initiatives with a capacity verdict · tasks and the key-result-linked board · rich '
     'documents with version history · file attachments. Deliberately OKR-shaped, not a '
     'project management suite'),
    ('D', 'Coaching and AI',
     'The Draft Coach rule engine · the OKR Coach and OKR Champion · agent governance with '
     'least privilege, proposals and hard caps · the nudge engine · assists everywhere · '
     'the copilot · bring your own provider, including local models'),
    ('E', 'Channels and reach',
     'Browser · email · Slack · Microsoft Teams · WhatsApp Business · Telegram · any '
     'external AI agent acting as its user. Every inbound message runs the same permission '
     'checks as a click'),
    ('F', 'Platform',
     'Spaces · people and org chart · relationship-based access · comments, mentions and '
     'notifications · activity feed · search and command palette · admin and audit · '
     'encrypted export and import · spreadsheet and FlowyTeam importers · accessibility')]
cw = (CW - 2 * 16) / 3
for index, (letter, title, body) in enumerate(pillars):
    x = M + (index % 3) * (cw + 16)
    ry = y + (index // 3) * 150
    s.rect(x, ry, cw, 138, fill=WHITE, line=LINE, radius=8)
    s.rect(x + 18, ry + 16, 22, 22, fill=BRAND_WEAK, radius=6)
    s.text(x + 18, ry + 21, 22, 14, [para(letter, 10.5, BRAND_600, bold=True, align='ctr')])
    s.text(x + 48, ry + 18, cw - 66, 18, [para(title, 13, INK, bold=True)])
    s.text(x + 18, ry + 48, cw - 36, 82, [para(body, 10.5, INK3, line=126)])
chrome(s)

# ------------------------------------------------------- how it runs

s = new(WHITE)
y = heading(s, 'One release, run two ways', 'Deployment and licence')
rows = [['How', 'Who it suits', 'What it takes'],
        ['Self-hosted, one server', 'Anyone who wants data on their own machines',
         'One Docker Compose file and a first-run wizard that generates every secret. Target: under 30 minutes'],
        ['Self-hosted, Kubernetes', 'Universities, government, large enterprise',
         "A Helm chart, the customer's own PostgreSQL, single sign-on and backups"],
        ['Managed cloud', 'Teams that do not want to run anything',
         'Sign up, name a workspace, start. The same container under our operation']]
s.table(M, y, [190, 250, CW - 440], rows, row_h=46, size=11.5)
y += 190
cw = (CW - 20) / 2
s.rect(M, y, cw, 128, fill=BRAND_WEAK, line=BRAND_LINE, radius=8)
s.text(M + 22, y + 20, cw - 44, 20, [para('AGPL-3.0, plus a contributor agreement', 13.5, BRAND_600, bold=True)])
s.text(M + 22, y + 46, cw - 44, 72,
       [para('AGPL stops a third party selling a closed hosted version. An organisation '
             'self-hosting for its own staff takes on no obligations at all. The contributor '
             'agreement preserves the right to run a paid cloud and to relax the licence later.',
             11.5, BRAND_600, line=128)])
s.rect(M + cw + 20, y, cw, 128, fill=BG, line=LINE, radius=8)
s.text(M + cw + 42, y + 20, cw - 44, 20, [para('Air-gap capable, by construction', 13.5, INK, bold=True)])
s.text(M + cw + 42, y + 46, cw - 44, 72,
       [para('No feature hard-depends on an external service. AI points at a local model or is '
             'off. Channels are optional, telemetry is opt-in, assets are self-hosted. Tenant '
             'isolation is enforced inside the database, not in application code.',
             11.5, INK2, line=128)])
s.text(M, y + 142, CW, 22,
       [para('**Self-host is never seat-limited and never feature-gated. The cloud sells '
             'operation, not features.**', 13.5, BRAND_DARK)])
chrome(s)

# --------------------------------------------------------- status and roadmap

s = new(BG)
y = heading(s, 'Fully specified, and sequenced so the coach is not last', 'Status',
            'Eight phases, 104 scoped tasks, each with acceptance criteria and a test plan.')
phases = [('1', 'Foundation', 'Monorepo, database with the tenant floor, adapter ports and the outbox, authentication, the single write pipeline, Compose and Helm'),
          ('2', 'Platform and agent spine', 'Access model, people, notifications, design system, and the AI foundation: provider port, keys, metering, the agent runtime'),
          ('3', 'The OKR core', 'Cycles and the guided workflow, goals and key results, scoring, cadence, check-ins, alignment, KPIs with recovery, the Work Map'),
          ('4', 'The coaching layer', 'The method library, the Draft Coach, both agents, the trigger catalogue, the weekly and quarterly sessions, the copilot'),
          ('5', 'Reach', 'Slack, Teams, WhatsApp, Telegram, the external agent server, initiatives, tasks and the board, documents, search'),
          ('6', 'Data', 'The spreadsheet importer with the AI mapper, the FlowyTeam importer, workspace export and import, backups with restore drills'),
          ('7', 'Hardening', 'Performance at scale, load and soak testing, the security review, the accessibility audit, observability'),
          ('8', 'Cloud and launch', 'Tenant provisioning, the operator console, single sign-on and directory sync, the air-gap guide, documentation, launch')]
for index, (number, title, body) in enumerate(phases):
    x = M + (index % 2) * (CW / 2 + 10)
    ry = y + (index // 2) * 62
    s.rect(x, ry, 24, 24, fill=BRAND if index < 4 else BRAND_LINE, radius=12)
    s.text(x, ry + 5, 24, 16,
           [para(number, 11, WHITE if index < 4 else BRAND_600, bold=True, align='ctr')])
    s.text(x + 36, ry, CW / 2 - 56, 18, [para(title, 13, INK, bold=True)])
    s.text(x + 36, ry + 20, CW / 2 - 56, 36, [para(body, 10.5, INK3, line=124)])
s.text(M, y + 258, CW, 22,
       [para('The AI and agent foundation lands in phase two so the coaching layer ships in '
             'phase four, beside the OKR core. **An OKR tool where the coach arrives last is '
             'just another tracker.**', 12.5, BRAND_600, line=126)])
chrome(s)

# ------------------------------------------------------------------- the risk

s = new(WHITE)
y = heading(s, 'The risk we are managing, openly', 'Status')
s.rect(M, y, CW, 116, fill=BADBG, line='FCA5A5', radius=8)
s.text(M + 26, y + 24, CW - 52, 74,
       [para('A coaching engine that produces false positives is worse than no coaching at '
             'all, because people learn to dismiss it.', 18, BAD, bold=True,
             face='Calibri Light', line=126)])
y += 142
cw = (CW - 20) / 2
s.text(M, y, cw, 20, [para('What we are doing about it', 14, INK, bold=True)])
s.text(M, y + 26, cw, 110,
       [para('The warn-versus-fail line on all twenty rules will be tuned against a corpus of '
             'real, anonymised OKRs before launch. Assembling that corpus is a named deliverable '
             'of the coaching phase design gate, not an afterthought.', 12.5, INK2, line=130)])
s.rect(M + cw + 20, y - 12, cw, 140, fill=BRAND_WEAK, line=BRAND_LINE, radius=8)
s.text(M + cw + 42, y + 8, cw - 44, 20,
       [para('Where a partner adds the most value', 14, BRAND_600, bold=True)])
s.text(M + cw + 42, y + 34, cw - 44, 90,
       [para('This is the single place where methodology expertise changes the product most. '
             'A partner who can challenge a threshold, or contribute real OKRs to tune against, '
             'moves the quality of every coaching message in the product.',
             12.5, BRAND_600, line=130)])
chrome(s)

# ----------------------------------------------------------- working with us

s = new(BG)
y = heading(s, 'Three different conversations', 'Working with us')
cw = (CW - 2 * 18) / 3
asks = [('A methodology institute', BRAND,
         'Review the method specification, and challenge any rule, threshold, band or agenda '
         'you think is wrong. Help us assemble the tuning corpus.',
         'Your practice becomes enforceable software that keeps working after the engagement '
         'ends, with every rule attributable, versioned and arguable.'),
        ('An investor', '7C3AED',
         'A conversation about the category, the open source route to market, and the plan to '
         'first revenue.',
         'A fully specified product with an unusually defensible core, in a market currently '
         'served by passive databases.'),
        ('An early customer', '0EA5E9',
         'Run a real quarter on it, with us, and tell us where the coaching is wrong.',
         'Free use for the pilot, direct influence on the rules and the roadmap, and no '
         'lock-in of any kind because the whole workspace exports at any time.')]
for index, (title, colour, ask, give) in enumerate(asks):
    x = M + index * (cw + 18)
    s.rect(x, y, cw, 250, fill=WHITE, line=LINE, radius=8, shadow=True)
    s.rect(x, y, cw, 3.5, fill=colour)
    s.text(x + 20, y + 22, cw - 40, 22, [para(title, 15, INK, bold=True)])
    s.text(x + 20, y + 56, cw - 40, 14,
           [para('WHAT WE ASK', 8.5, colour, bold=True, spacing=1.1)])
    s.text(x + 20, y + 76, cw - 40, 76, [para(ask, 11.5, INK2, line=128)])
    s.rect(x + 20, y + 160, cw - 40, 0.75, fill=LINE)
    s.text(x + 20, y + 174, cw - 40, 14,
           [para('WHAT YOU GET', 8.5, INK4, bold=True, spacing=1.1)])
    s.text(x + 20, y + 194, cw - 40, 76, [para(give, 11.5, INK3, line=128)])
chrome(s)

# ------------------------------------------------------------------ closing

s = new(BRAND_DARK)
s.rect(0, 0, W, H, gradient=(BRAND_DARK, '3730A3', 40))
s.rect(0, 0, W, 4, fill=BRAND)
s.text(M, 176, 800, 120,
       [para('The practice is the product.', 44, WHITE, bold=True,
             face='Calibri Light', line=120)])
s.rect(M, 288, 64, 3, fill=BRAND)
s.text(M, 312, 720, 80,
       [para('Every rule, threshold, band, corridor, taxonomy and agenda in one specification, '
             'compiled into code, enforced at the point of writing, and worked by two teammates '
             'who initiate.', 15, '9FA8DA', line=134)])
s.text(M, 440, 720, 40,
       [para('The full planning set behind this deck is available on request: requirements, '
             'architecture, the method canon, the schema, forty screen specifications and 104 tasks.',
             11.5, '7986CB', line=130)])

pptx.write(deck, os.path.join(HERE, os.pardir, 'OpenOKR-Deck.pptx'),
           'OpenOKR: product overview', 'OpenOKR')
print('wrote OpenOKR-Deck.pptx with %d slides' % len(deck))

if os.environ.get('PREVIEW'):
    import preview
    print('preview at', preview.write(deck))
