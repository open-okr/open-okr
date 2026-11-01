# Security

| | |
|---|---|
| URL | `/security` |
| Audience | Security reviewers, IT, data protection officers, and the buyer who has to forward their questions |
| The page's one job | Answer the security questionnaire before it is sent, with specifics a reviewer can check |
| Primary CTA | Download the security overview |
| Secondary CTA | Talk to us |
| Page title | Security at OpenOKR and OKRGoal: isolation, audit and no back door |
| Meta description | Tenant isolation inside PostgreSQL, one authorisation checkpoint, a hash-chained audit log, envelope-encrypted secrets, signed releases, consent-only support access, and AI you control. Open source, so you can read all of it. |

## Section structure

| # | Section | Layout |
|---|---|---|
| 1 | Hero | H1, subhead, two buttons |
| 2 | Read it yourself | One paragraph, GitHub link |
| 3 | Three layers | Three columns |
| 4 | Sign-in and identity | Checklist |
| 5 | Data and secrets | Checklist |
| 6 | Agents and AI | Checklist |
| 7 | Chat channels | Short |
| 8 | Support access | Highlighted card |
| 9 | Resilience | Checklist |
| 10 | Supply chain | Checklist |
| 11 | Privacy | Checklist |
| 12 | Certifications | Short, honest |
| 13 | Report a vulnerability | Short |
| 14 | Final CTA | |

---

## 1. Hero

**Eyebrow:** Security

# Built to pass the security review.

Isolation inside the database. One permission check for every route in. An audit log that shows when it has been tampered with. And a support team that cannot open your workspace unless you let it.

**Buttons:** `[ Download the security overview ]` `[ Talk to us ]`

## 2. Read it yourself

## Do not take our word for it.

OpenOKR is open source. Every control on this page is in the code, and most of them are enforced by a test that fails the build if somebody removes them. Your security team can read the source, run it on their own machine and point their own tools at it.

**Link:** Read the source on GitHub →

## 3. Three layers

## Two walls and a record.

| Isolation in the database | One authorisation checkpoint | An audit log you can verify |
|---|---|---|
| Every business table carries its workspace and a row-level security policy in PostgreSQL, shipped in the same change as the table. The application's database role cannot bypass it. A forgotten filter in the code still cannot read another workspace's rows. | Every read of a protected object goes through one access-aware function, and every write through one permission check. The browser, the API, the command line, the chat apps and the agents all use the same one. A forbidden object answers "not found", so its existence does not leak. | Every sensitive action writes an append-only audit row inside the same transaction as the change, naming who acted and through which channel. Rows are chained by hash, so a changed or deleted row breaks the chain. Verify it from the admin screen. |

## 4. Sign-in and identity

- Authentication through Better Auth, an established open source library. Nothing hand-rolled
- Passwords, passkeys, and authenticator codes with backup codes
- Enforce a second factor for the whole workspace
- Single sign-on with OIDC and SAML 2.0
- Directory sync with SCIM 2.0, for Okta, Microsoft Entra ID and others
- Session tokens stored hashed
- Rate limiting, and account lockout with back-off
- Suspended members get no access anywhere, at once
- External agents sign in with OAuth 2.1 and a consent screen. Tokens are short-lived, refresh tokens rotate on every use, and a reused one revokes the whole grant

## 5. Data and secrets

- Provider keys, mail passwords and channel credentials are envelope-encrypted, opened only on the server, and never logged
- Rotate the root key with one command. Only the data keys are re-wrapped
- The instance refuses to start in production with placeholder secrets
- Rich text is stored as structured data and rendered through an allow-list, in the browser, in email and in exports. No raw HTML passes through anywhere
- Every input is validated at the boundary
- A strict content security policy with per-response nonces, secure cookies and transport security
- Personal data is kept out of logs

## 6. Agents and AI

- Built-in agents act as their own members, with access to named spaces and goals only. There is no service account with access to everything
- By default an agent proposes and a person approves. Sandbox mode commits nothing
- Every agent step is metered, and a hard cap halts a run mid-flight
- Retrieved content is treated as data, never as instructions, and tests prove an injected instruction cannot exceed an agent's access
- Choose what context may reach an AI provider, redact email addresses and phone numbers, and allow-list the hosts it may call
- With a local model, nothing leaves your network
- With AI off, every rule still runs

## 7. Chat channels

Every inbound message from Slack, Teams, WhatsApp or Telegram is checked against the provider's signature before anything else, matched to a member, rate-limited, and run through the same permission check as a click. A message from someone we do not recognise gets nothing back, not even an error that confirms the workspace exists.

## 8. Support access

**Highlighted card:**

## No back door. Not even for us.

Nobody at OKR Institute can open your OKRGoal workspace unless a workspace owner grants a support session. The request names the person and the reason. A session lasts four hours by default and twenty-four at most, then ends by itself. While it is live, a banner on every screen, for every member, says who is in and for how long, with a button to end it. That banner cannot be dismissed.

There is no emergency override. We chose not to build one, because an override built "just in case" becomes the normal way in.

## 9. Resilience

- Encrypted backups, and a command that proves a backup would restore without touching the live database
- Restore drills run automatically in our build
- Migrations only move forward, and an upgrade takes a backup first
- A read-only freeze for maintenance windows and incidents
- Every release is tested end to end, including with the AI switched off

## 10. Supply chain

- Every release is a signed, multi-architecture container image with a software bill of materials
- Code scanning and dependency review on every change
- A licence gate on every dependency
- Every commit signed off by its author
- A pinned lockfile
- Vendor libraries are confined to one package, which is what makes running offline real
- An air-gap checklist checked against the source on every change

## 11. Privacy

- Self-hosting keeps your data in your country, on your servers
- Export the whole workspace whenever you like
- Erasure anonymises a person and keeps the authorship of the work, so history still makes sense
- Handling designed for PDPA and GDPR obligations
- No telemetry from a self-hosted instance unless you opt in
- Built to WCAG 2.1 AA, with every screen scanned automatically on every change

## 12. Certifications

> **Decision needed:** OKRGoal holds no certification today. Choose one of these before launch:
> 1. Say so, and say what is planned: *"OKRGoal is working towards SOC 2 Type II. Until then, the source, the architecture and our answers to your questionnaire are open to you."*
> 2. Leave the section out until there is something to show.
>
> Never imply a certification by putting a badge near this page.

## 13. Report a vulnerability

## Found something?

Report it privately through the security route in the GitHub issue chooser, not in a public issue. We will acknowledge it, keep you informed, and credit you if you want to be named.

> **Decision needed:** a security contact address, a response time, and whether there is a bug bounty.

## 14. Final CTA

## Send us your questionnaire.

We would rather answer it properly than have you guess.

**Buttons:** `[ Download the security overview ]` `[ Talk to us ]`

> **Decision needed:** the security overview PDF does not exist yet. It should be a short document built from this page and TECHNICAL-PLAN.md §8.
