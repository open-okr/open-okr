# Time to the copilot's first word

Status: **design approved by Agung on 19 November 2026**. Live AI measurement is capped at 5 USD on OpenRouter. Release 0.9.1 C1.

The 0.9.0 release check reported a median of about 11 seconds over five GPT-6 Luna turns. The step line appeared earlier. A turn can pay for retrieval, offer preparation, the first model call, up to four tool rounds and a separate answer call. The elapsed time of each part has not been measured on the same live sample.

## Decisions

| Decision | Implementation |
|---|---|
| Measure a baseline before changing the loop. | Time from Send on the browser's monotonic clock to the first visible non-whitespace answer word. Time preparation, access and budget checks, each provider round, each tool execution and the wait for the first answer token separately on the server. Correlate with a per-run ID and round index. Record counts and durations only. Keep question text, record titles, tool arguments and model output out of telemetry. |
| Start with a narrow fast path. | Test bypassing model tool selection for a first-turn read-only question anchored to an objective, KPI, initiative or task when the existing scoped anchor read succeeded and contains the requested fact. Start with explicit requests for one field of the current record and a short summary of that record. Use deterministic matching over the existing field names, route ambiguous prompts to the current loop and test the rules in both supported locales. Pass the same numbered record to the existing grounded answer stream. Preserve the final credit, budget and stop checks. |
| Keep the read loop for other turns. | Use the current selector for an unanchored live question, a follow-up, a request that compares or asks about another record, an uncertain classification, a missing or refused anchor, and anything that may ask for a change. Keep the existing proposal paths, access checks, reference numbering and limits. The AI-off path continues to use the existing matching passages. |
| Compare before and after on the same questions. | Freeze fixtures and the Northwind sample after C2 and C3. Use the same model, provider configuration, seeded data and personas. Pair baseline and candidate runs and record cold and warm samples separately. Report time to first word, per-round durations, call counts, and citation and answer scores. Use the existing evaluation runner for fixtures, then a few live calls within the owner's allowance. Record the live sample size and distinguish observed latency from the broader target. |
| Set the acceptance threshold by question class. | Aim for roughly two seconds median from Send on the eligible simple prompts. Report multi-read timings separately. Each eligible fixture must still answer from the correct, current, access-scoped record and cite it. Multi-read, ambiguous and proposal fixtures must retain their current grounded answers, citations and proposal outcomes. Drop the fast path if it cannot meet those quality checks. |

## Measurement matrix

| Given | When | Then |
|---|---|---|
| An accessible anchor with its current health, assigned owner or latest value | The member sends a first-turn question about that field | The candidate streams an answer grounded in the anchor, cites it and records zero provider selection rounds. |
| A question requiring another record or several reads | The member asks it from the same page | The existing selector can run all the reads it needs. Report its latency separately from the simple sample. |
| A refused anchor, conflicting names or an earlier turn the question refers to | The member sends the question | The ordinary path runs and a refused record is absent from the answer and citations. |
| A request for a check-in, task or other supported proposal | The member sends it from the panel | Proposal gating, confirmation, the card event and any clarifying question work through the existing flow. |
| The run is stopped or the budget runs out | The candidate reaches a provider call | The existing stop or budget outcome wins, even when the fast path already obtained the anchor. |

Start with `packages/core/test/copilot-reading.test.ts`, the provider evaluation fixtures, and `e2e/s39d-copilot-reads.spec.ts`. Include an equivalent English and Malay prompt, a denied fixture, a proposal fixture and the multi-round fixture. Publish the measurement and quality comparison in the release build log before enabling the path. The [live data design](copilot-live-data.md) remains the source for tool, proposal and citation rules.
