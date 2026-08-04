# Stakeholder pack

The shareable overview of OpenOKR, for a methodology partner, an investor or an early customer. It is a summary of the plan set in `docs/development-plan/`, not an authority over it. When a fact here disagrees with a planning document, the planning document wins and this one gets corrected.

| File | What it is |
|---|---|
| `OpenOKR-Overview.docx` | **The deliverable.** A4, ~20 pages, eleven screen mockups. Generated, so never edit it directly |
| `OpenOKR-Overview.md` | The source text. Edit this |
| `mockups/src/*.html` | The mockup screens, hand-built against UIUX-PLAN.md §2 and the S-xx screen specifications |
| `mockups/png/*.png` | Rendered at 1440 wide, 2x, palette-optimised. Reusable in a deck or on a site |
| `build.sh` | Markdown to Word |
| `render.sh` | Mockups to PNG |

## Rebuilding

```bash
./mockups/render.sh   # only after editing a mockup
./build.sh            # writes OpenOKR-Overview.docx
```

`render.sh` needs a Chromium headless shell. It looks in the Playwright browser cache and falls back to Google Chrome, and `CHROME=/path/to/binary` overrides both. `build.sh` needs pandoc and python3 with Pillow.

## How the Word file is produced

`build.sh` runs three steps.

1. **Restyle.** `style-reference.py` rewrites pandoc's default reference document: Calibri throughout, indigo headings, A4 geometry, a page footer, and a table style with a shaded header row. The title page has no footer.
2. **Convert.** Pandoc turns the markdown into Word using that reference. Page breaks are raw OpenXML blocks in the markdown.
3. **Fit tables.** `fit-tables.py` replaces pandoc's equal column widths with widths allocated from how much text each column actually carries, damped and clamped so no column collapses or swallows the table.

There is no automatic table of contents. Word's TOC field renders empty in Google Docs, Pages and Preview, so the contents page is written out as an ordinary table instead.

## Screen coverage

| Mockup | Screen specification |
|---|---|
| `01-work-map` | S-01 Work Map |
| `02-cycle-workspace` | S-04 Cycle workspace, S-06 Phase 1 prepare |
| `03-draft-coach` | S-09 Phase 4 draft OKRs |
| `03b-rule-card` | The coaching verdict detail from S-09 |
| `04-gates-capacity` | S-10 Phase 5 align and commit |
| `05-alignment-studio` | S-16 Alignment studio |
| `06-kpi-recovery` | S-18 KPI tree, S-19 Recovery board |
| `07-weekly-session` | S-22 Weekly session, steps 1 and 2 |
| `08-quarterly-review` | S-24 Quarterly review, root cause and diagnostic |
| `09-channels` | Slack, Microsoft Teams, WhatsApp and Telegram surfaces |
| `10-review-inbox` | S-02 Review, what I owe |

Every number, rule key, band and threshold shown in the mockups comes from `docs/development-plan/METHOD.md`. If a rule changes there, the mockups that quote it need updating too.
