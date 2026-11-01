# Solutions: universities, government and regulated sectors

| | |
|---|---|
| URL | `/solutions/public-sector` |
| Audience | Strategy and planning offices, and the IT and data-protection teams who must approve the tool, at universities, government bodies, health and finance |
| The page's one job | Show that OpenOKR can run on their servers, in their country, offline if needed, and pass their review |
| Primary CTA | Talk to us |
| Secondary CTA | Read the install guide |
| Page title | OKRs for universities, government and regulated sectors: self-hosted and auditable · OKRGoal |
| Meta description | Run OpenOKR on your own servers, in your own country, even fully offline. Single sign-on, directory sync, a tamper-evident audit log, AI you can switch off, and no seat limits. Open source under AGPL-3.0. |

## Section structure

| # | Section | Layout |
|---|---|---|
| 1 | Hero | H1, subhead, buttons |
| 2 | Five things your review will ask | Question and answer cards |
| 3 | Planning cycles that match yours | Annual and quarterly, governed profile |
| 4 | On your infrastructure | Helm, your database, your sign-on |
| 5 | AI optional, by design | Short |
| 6 | Cost | No seat limit |
| 7 | Final CTA | |

---

## 1. Hero

**Eyebrow:** Universities and public sector

# On your servers. In your country. Offline if you need it.

OpenOKR runs your institution's OKRs on infrastructure you control, with the whole method built in and the governance and audit trail you are required to keep. It is open source, it is complete, and it never needs to call home.

**Buttons:** `[ Talk to us ]` `[ Read the install guide ]`

## 2. Five things your review will ask

## The questions, answered before the meeting.

| Question | Answer |
|---|---|
| **Where does the data live?** | Wherever you run it. Self-host on your own servers or your own Kubernetes, in your own country. PostgreSQL is the only service it needs |
| **Can it run without internet access?** | Yes. A local AI model or none, assets served from the instance, chat channels optional, telemetry off. An air-gap checklist is checked against the source on every change |
| **Who can see what?** | Database-level isolation, one permission check for every route in, editable roles, and spaces with their own access scope. Suspended members lose access everywhere at once |
| **Can we prove what happened?** | An append-only, hash-chained audit log, written in the same transaction as every sensitive change, naming who acted and through which channel. Verify the chain with one click |
| **Does it fit our identity setup?** | OIDC and SAML 2.0 single sign-on, and SCIM 2.0 directory sync with Okta, Microsoft Entra ID and others. Included, not an add-on |

**Link:** Read the security page →

## 3. Planning cycles that match yours

## Annual strategy, quarterly delivery.

Most institutions plan by the year and deliver by the term or the quarter. OpenOKR does both: an annual cycle that sets the frame, with mission, strategies, annual objectives and a not-doing list, and quarterly cycles that revalidate the frame in under an hour and set the quarter's work inside it.

For a formal planning process, the **Governed** profile makes the phases binding, opens a planning window for writing objectives, routes new mid-cycle objectives through a reviewer, and requires a reviewer on every goal. Every setting change is audited.

## 4. On your infrastructure

## Your Kubernetes, your database, your backups.

The Helm chart deploys the application and nothing else. It brings no database, manages no certificates and runs no mail server, because your platform team already has answers for all three. Migrations run as a hook from the same signed image before the application rolls, so an upgrade is `helm upgrade`. You choose when to upgrade. Nothing updates itself.

| Your PostgreSQL | Your sign-on | Your backups | Your schedule |
|---|---|---|---|
| With the pgvector extension, and a role that cannot bypass row-level security | OIDC or SAML 2.0, plus SCIM | Encrypted, with a command that proves a restore works | Pin a version. Upgrade when you are ready |

## 5. AI optional, by design

## Turn it off. Every rule still runs.

Every quality check, gate, score, nudge, escalation and diagnostic is deterministic code. Switch AI off and nothing that matters stops. If your policy allows AI, point it at a model you host yourself, and nothing leaves your network.

## 6. Cost

## No seats to count.

Self-hosted OpenOKR has no seat limit, no licence key and no paid edition. Thirty thousand staff and students cost the same as thirty. If you want a support contract with named contacts and response times, we offer one, for the same software.

**Line:** Languages: English and Bahasa Melayu.

## 7. Final CTA

## Start with a pilot in one faculty or department.

We will help you stand it up on your own infrastructure and run the first cycle.

**Buttons:** `[ Talk to us ]` `[ Read the install guide ]`
