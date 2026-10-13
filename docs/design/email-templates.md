# Email templates

Status: design approved on 12 October 2026, with one condition: every button and link in a mail opens a page that works. Built: the renderer, the account mails, the invitation, the notification digest and every agent nudge by email.

Every mail the product sends is plain text today. The one exception is the notification digest, which carries a bare `<ul>`. AI-NATIVE-PLAN §5 asks for email as "HTML and plain text, one-click action links". This design gives every mail one shared layout, in both parts.

The reference drawing is [12-email-templates](../mockups/src/12-email-templates.html), with all six mails in light and dark.

## 1. Goals

| Goal | What it means here |
|---|---|
| One layout | A single renderer builds every mail. A mail supplies blocks, never markup |
| Both parts from one source | The HTML part and the text part come from the same blocks, so they cannot say different things. Today the digest's "and N more" line is in the text part only |
| Compact | One card, 560px wide at most, 14px body, 24px padding, one primary action |
| Works everywhere | Gmail, Outlook (Windows and web), Apple Mail and iOS Mail render it the same |
| Air-gap safe | No web font and no remote image. The mark is text, and the instance serves nothing to a mail client |
| Readable in the console driver | The console transport prints the text part, which reads as a complete mail on its own |

## 2. Anatomy

```
[mark] Workspace or instance name              header, outside the card
+--------------------------------------------+
| EYEBROW                                    |  optional, 11px uppercase
| Heading                                    |  18px, one line ideally
| Body paragraph(s)                          |  14px / 1.6
| [ Primary action ]                         |  one button at most
| Button not working? <link>                 |  always, for the action
| +----------------------------------------+ |
| | Notice: expiry, "not you?"             | |  optional soft box
| +----------------------------------------+ |
+--------------------------------------------+
Why you got this · Change what you receive      footer, outside the card
```

The mark is a 24px rounded square holding two initials, filled with the brand colour. It is text rather than an image, so nothing is fetched.

## 3. Blocks

A mail is a list of blocks. The renderer turns each block into table markup with inline styles, and into the text lines for the plain part.

| Block | HTML | Text part |
|---|---|---|
| `eyebrow` | 11px uppercase label | omitted |
| `heading` | h1, 18px | the line, then a blank line |
| `paragraph` | p, 14px. Bold spans only | the line |
| `action` | a bulletproof button (a table cell with `bgcolor`), then the raw link | `Label: url` |
| `notice` | a soft grey box, 13px | the line |
| `items` | rows split by a hairline: chip, time, line, link to the subject | `- line (url)` |
| `nudge` | a card with a severity edge, the rule key and the escalation step | `- title: line (rule key, step n)`, then the url |
| `stats` | up to three tiles: on track, at risk, off track | `5 on track, 2 at risk, 1 off track` |
| `list` | a titled bullet list | the title, then `- item` |
| `richText` | `renderRichTextToHtml`, the sanitising allow-list renderer | the shared plain-text excerpt |

Every value is escaped by the renderer, and a mail can pass no raw HTML. Rich text goes through the existing allow-list, as CLAUDE.md requires for every surface.

## 4. Tokens

These are the UI's own values from `packages/ui/src/styles/tokens.css`, written inline because mail clients do not read CSS variables.

| Token | Light | Dark (clients that honour `prefers-color-scheme`) |
|---|---|---|
| Page | `#eff3f9` | `#0b1220` |
| Card | `#ffffff`, border `#e4e9f2` | `#111827`, border `#1e293b` |
| Ink, ink-2, ink-3 | `#0f172a`, `#334155`, `#55637a` | `#f1f5f9`, `#cbd5e1`, `#94a3b8` |
| Brand (button, mark) | `#4f46e5` | same |
| Link | `#4338ca` | `#818cf8` |
| On track, at risk, off track | `#15803d`, `#b45309`, `#b91c1c` on their tints | `#4ade80`, `#fbbf24`, `#f87171` on dark tints |
| Font | `-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif` | same |

Dark mode is an enhancement. A client that strips the `<style>` block (Gmail) shows the light version, which is complete on its own.

## 5. The six mails

| Mail | Sent by today | Header shows | Action |
|---|---|---|---|
| Password reset | `apps/web/lib/auth.ts` | instance name | Choose a new password |
| Confirm email | `apps/web/lib/auth.ts` | instance name | Confirm email |
| Invitation | outbox `invitation.email` | workspace name | Accept the invitation |
| Notification digest | outbox, `renderDigest` | workspace name | Open your inbox |
| Agent nudges | email channel, `nudges/deliver.ts` | workspace name | one link per nudge |
| ~~Weekly digest post~~ | `actions/digest-posts.ts` | | |

**The weekly digest is not a mail.** `sessions.postDigest` posts it to the Slack or Teams channel a space links, and the email driver refuses a space channel by design. The drawing shows it as a proposal only. Sending it by email would be a new proactive message kind, which is a human decision (CLAUDE.md), so it is not built.

**An agent nudge by email** is one of three shapes, all from the draft the chat channels share: a single nudge (headline, the coach's line, the action, the rule key), a blocker card (its own lines), and the daily summary (the rows since the member last looked, and what the weekly ceiling held). The drawing's "2 things need you today" combines two nudges, which the product does not do: each nudge is its own message.

The subject of every workspace mail starts with the workspace name, as the nudge digest already does. "3 updates" alone does not say where from.

## 6. Where the code goes

| Piece | Location | Why there |
|---|---|---|
| `renderEmail(blocks, frame)` returning `{ html, text }` | `packages/core/src/mail/` | Pure strings, no vendor SDK. Core already builds the digests and the invitation |
| The six mail builders | beside the code that sends each mail today | Each sender keeps its own wording and data |
| The `html` part on the email channel | `packages/adapters/src/drivers/channel/email.ts` | The channel can only carry text today. The port already has `html?` |
| `sendMail` in the web app | `apps/web/lib/mail.ts` | It takes `{ to, subject, text }` today, so `html` is added |

There is no new dependency and no template engine. The layout is about 200 lines of string building, and the same function renders the mockup.

## 7. Tests

| Test | What it catches |
|---|---|
| Every block escapes `<`, `>`, `&` and quotes | Markup injected through a goal title or a comment |
| The text part holds every action url and every item | The two parts drifting apart, as the digest's "and N more" did |
| The HTML holds no `http` url outside the mail's own links and the instance base url | A remote font or image creeping in, which breaks air-gapped installs |
| One snapshot per mail | An unreviewed change to what a person receives |
| The digest's "and N more" line is in both parts | The bug found while mapping this |

## 8. Acceptance criteria

1. **Given** a password reset on an instance with SMTP, **when** the mail arrives, **then** it has an HTML part with the layout and a text part with the same link.
2. **Given** a goal titled `<script>alert(1)</script>`, **when** a digest names it, **then** the HTML shows the text escaped and runs nothing.
3. **Given** the console transport, **when** any of the six mails is sent, **then** the logged text part reads as a complete message.
4. **Given** a client that strips `<style>`, **when** the mail opens, **then** the light version shows, readable and complete.
5. **Given** a digest with 12 items and a limit of 10, **when** it is sent, **then** both parts say "And 2 more in your inbox".

## 9. Proposed split

One change is one commit (CLAUDE.md), and six mails plus a port change do not fit in one. Proposed:

| Change | Contents |
|---|---|
| 1 | The renderer, its tests, and the two auth mails (reset, confirm) |
| 2 | Invitation and notification digest, including the "and N more" fix |
| 3 | The email channel's `html` part, agent nudges and the weekly digest post |

## 10. Decisions

| Question | Decided |
|---|---|
| The button colour | Indigo for account mails. The workspace's `branding.primaryColor` for workspace mails when white text on it reads at 4.5:1, indigo otherwise (`buttonColour`) |
| Language | `packages/core/src/mail/words.ts` (en, ms), because most mails are built in core, which may not read the web catalogue. Account mails use `instance.language`, because the person may belong to no workspace yet. Workspace mails use the workspace's language. The rule titles and the coach's lines inside a nudge come from METHOD.md and stay in English |
| A real logo image | Not now. A logo needs storage and a url the instance serves, which is a separate change |
| The inviter's name in the invitation | Yes, when the invitation records who sent it |
| Every link works | Every link is a real route, checked by following it in a test (§7) |

## 11. Links in each mail

The condition the approval carried: every button and link opens a page that works.

| Mail | Link | Lands on | Proved by |
|---|---|---|---|
| Password reset | Better Auth's reset url | `/reset-password`, then sign-in | Followed end to end from Mailpit on the UAT instance, 12 October 2026 |
| Confirm email | Better Auth's verification url | The home screen, signed in | `account-mail.test.ts` checks the url is the one handed over |
| Invitation | `/join/<token>` | The join page, then sign-up | Followed end to end from Mailpit |
| Notification digest | each row's subject page, `/inbox`, `/account/channels` | The goal, the inbox, notification settings | Followed end to end from Mailpit |
| Agent nudge | the nudge's own link (the goal, the check-in, the inbox), `/account/channels` | That page, then snooze and channel settings | Followed end to end from Mailpit |

Chat-only buttons (`okr:checkin <goal>`) are left out of a mail: a command in an email is a line nothing happens to.
