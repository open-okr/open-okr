# Stakeholder pack

The shareable overview of OpenOKR, for a methodology partner, an investor or an early customer. It is a summary of the plan set in `docs/development-plan/`, not an authority over it. When a fact here disagrees with a planning document, the planning document wins and this one gets corrected.

The `mockups/` folder does double duty. It supplies the screenshots for both artifacts here, and it is the **reference guide the UI implementation tasks cite**, indexed in [UIUX-PLAN.md §10](../development-plan/UIUX-PLAN.md). See [mockups/README.md](mockups/README.md) before changing any of them.

| File | What it is |
|---|---|
| `DEMO-SCRIPT.md` | **The live demo.** How to stand a fresh instance up with `pnpm db:seed`, what to walk through, and what the build honestly does not have yet. The only artifact here that shows the running product rather than a picture of it |
| `OpenOKR-Overview.docx` | **The document.** A4, ~20 pages, eleven screen mockups. Generated, so never edit it directly |
| `OpenOKR-Deck.pptx` | **The deck.** 36 slides, 16:9, the same content and all eleven mockups. Also generated |
| `OpenOKR-Overview.md` | The document source. Edit this |
| `deck/make-deck.py` | The deck source. Every slide is laid out here |
| `mockups/src/*.html` | The mockup screens, hand-built against UIUX-PLAN.md §2 and the S-xx screen specifications |
| `mockups/png/*.png` | Rendered at 1440 wide, 2x, palette-optimised. Reusable on a site or in another deck |
| `build.sh` | Markdown to Word |
| `render.sh` | Mockups to PNG |

## Rebuilding

```bash
./mockups/render.sh          # only after editing a mockup
./build.sh                   # writes OpenOKR-Overview.docx
python3 deck/make-deck.py    # writes OpenOKR-Deck.pptx
```

`render.sh` needs a Chromium headless shell. It looks in the Playwright browser cache and falls back to Google Chrome, and `CHROME=/path/to/binary` overrides both. `build.sh` needs pandoc and python3 with Pillow. The deck needs neither: `deck/pptx.py` writes the OOXML itself.

## How the Word file is produced

`build.sh` runs three steps.

1. **Restyle.** `style-reference.py` rewrites pandoc's default reference document: Calibri throughout, indigo headings, A4 geometry, a page footer, and a table style with a shaded header row. The title page has no footer.
2. **Convert.** Pandoc turns the markdown into Word using that reference. Page breaks are raw OpenXML blocks in the markdown.
3. **Fit tables.** `fit-tables.py` replaces pandoc's equal column widths with widths allocated from how much text each column actually carries, damped and clamped so no column collapses or swallows the table.

There is no automatic table of contents. Word's TOC field renders empty in Google Docs, Pages and Preview, so the contents page is written out as an ordinary table instead.

## How the deck is produced

`deck/pptx.py` is a small PowerPoint writer: a .pptx is a zip of XML parts, and it writes them directly. That keeps the deck on the same design tokens as the mockups and avoids a dependency. It handles rounded rectangles, text boxes with mixed weight runs, pictures with a border and shadow, and simple tables, all positioned in points on a 960 x 540 slide.

Every shape is drawn explicitly rather than dropped into a layout placeholder, so slides look exactly as authored and stay fully editable in PowerPoint.

To check a layout before opening PowerPoint:

```bash
PREVIEW=1 python3 deck/make-deck.py
open deck/.preview/slides.html
```

`deck/preview.py` replays the same geometry in CSS at the same point coordinates. Fonts are approximate, so it proves layout and catches text overflow rather than being pixel-accurate. It also writes one page per slide, which is what the build screenshots for review.

## Slide map

| Slides | What they cover |
|---|---|
| 1 to 4 | Title, the opening statement, and the problem |
| 5 to 10 | What OpenOKR is: the two differences, the pure rule library, the two agents, deterministic-first, and who it is for |
| 11 to 25 | The product, screen by screen. Eleven mockups plus the eight phases, the six gates and the diagnostic |
| 26 to 29 | Why it wins: five differentiators, what each audience gets, and the target outcomes |
| 30 to 36 | The business: module inventory, deployment and licence, roadmap, the coaching-quality risk, the three asks, and the close |

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
