# The announcement

The text to post when a release goes out. Marked where it changes.

Keep it factual. An announcement that oversells a release is the one people
remember when the release disappoints them.

---

## OpenOKR `VERSION`

<!-- VERSION: the tag, without the v. -->

OpenOKR is an open source OKR platform that runs the practice rather than
storing it. Two things make it different from a tracker.

**The method is in the product.** The OKR practice is written out in one
document: the eight-phase cycle, the scoring bands, twenty-six quality checks
with their word lists, six publish gates, the alignment score, KPI health
corridors, the blocker taxonomy, both session agendas and the closing
diagnostic. That document is compiled into a library with no database and no
network access, and a conformance suite fails the build when the document and
the code disagree. Every message the product shows cites a rule that resolves
back to a paragraph you can read.

**The product is active.** Two agent members ship with every workspace. The
Coach guards quality; the Champion guards the rhythm. They initiate, escalate
and propose, in the browser, in Slack, Teams, WhatsApp and Telegram, by email,
and through any external AI agent you run. Every one of them works with the AI
provider switched off: AI adds drafting and language, never the decision.

It runs two ways from one release, self-hosted or managed cloud, and nothing is
feature-gated.

### Getting it

One server:

```
git clone https://github.com/open-okr/open-okr
cd open-okr/deploy/docker
./openokr up
```

Kubernetes, the managed cloud and the air-gapped path are in
[the documentation](https://github.com/open-okr/open-okr/tree/main/docs).

Every image is signed. Verify it before you run it; the command is on the
release page.

### Trying it without installing anything

<!-- Replace with the demo instance's address, or delete this section. -->

There is a public demonstration instance at `DEMO_URL`. Sign in as anybody the
sign-in page names. It holds a quarter in flight and a quarter that is
finished, both agents run in sandbox so nothing they propose is ever committed,
and the whole workspace is rebuilt every night.

### What is in this release

<!-- Paste the changelog section, or link the release. Do not summarise it
     again in different words: two descriptions of one change is how a
     changelog and an announcement start disagreeing. -->

See the release notes.

### Contributing

The plan set, the method document and every design document are in the
repository. Issues marked `good first issue` are real work with a named file to
start in, not busywork.

Commits carry a sign-off (`git commit -s`), and the first pull request from a
new contributor asks for the contributor licence agreement.

### Licence

AGPL-3.0.
