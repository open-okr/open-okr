---
"openokr": minor
---

An administrator now decides what may leave for an AI provider, and the product
enforces it on every AI request.

The privacy card on the AI console was three paragraphs of text. Nothing it
described could be changed, and one paragraph was not true: it said an assist
sends only the text it drafts from, while the copilot sent the passages it found
and the search index sent every item's text to be embedded.

The card is now a form with four controls:

- **What may be sent.** Everything a feature needs (as before), assists only,
  or nothing. With assists only, the copilot shows its passages without a
  written answer and nothing is sent to build the search index. With nothing,
  every assist falls back to its manual path and the agents run without
  drafting, as they do with AI off.
- **Replace email addresses and phone numbers** with a placeholder before a
  request leaves. On by default, including on workspaces upgraded from an
  earlier release. Names are sent as written.
- **Ask the provider not to keep or train on what is sent.** OpenRouter takes
  this on every request and routes only to providers that do not collect data.
  The card says plainly that Anthropic, OpenAI and Google take no such
  instruction. Off by default.
- **Hosts an AI request may reach.** Empty allows any provider you enable. A
  request to any other host is refused before it is sent.

None of the four applies to a provider at localhost or at a private network
address written as numbers, because nothing sent there leaves your network. A
name such as `ollama` is still governed, since only a name server knows where
it points; list it if you use the allow-list. When every tier is answered
locally, the card says so and greys the controls out.

Each request a control refuses or changes is written to the audit trail with
its host and how many addresses and numbers were replaced. The text itself is
never recorded. Nothing about how the product decides anything changes: with AI
off, or with a control withholding a request, every rule, score, gate and nudge
works exactly as before.
