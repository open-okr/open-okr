/**
 * The copilot's streaming answer (screen S-39, P4-T14a-b).
 *
 * One POST that streams. Server-Sent Events rather than a plain chunked body,
 * because an answer is not only words: the thread it landed in, the passages it
 * was grounded in and the message id it was recorded as all have to reach the
 * panel, and a named event per kind is how the session live route already does
 * that.
 *
 * **The stop control is this request being cancelled.** `request.signal` aborts
 * when the reader presses stop or closes the tab, and it is passed straight to
 * `streamAnswer`, whose `finally` records what had arrived. There is no separate
 * stop endpoint, and no partial answer is lost to one.
 *
 * A POST rather than a GET, because it writes: asking a question records it.
 * `EventSource` cannot POST, so the panel reads the body itself.
 *
 * **The run happens in the background, and this streams what it publishes**
 * (P4-T14b-b). An answer that existed only inside this response was lost the
 * moment the reader closed the tab, so there was nothing still going and
 * nothing to come back to. Now the question and an empty answer are written
 * here, a job produces the prose, and this subscribes to the channel that job
 * publishes on. Reloading is `/api/copilot/live` subscribing to the same one.
 *
 * **Unless nothing may be draining the queue**, in which case this answers
 * inline exactly as it did before. With `OPENOKR_RELAY=off` enqueuing here
 * could be enqueuing into nothing. With `elsewhere`, another process of this
 * instance drains it, such as the Helm chart's worker (plan 0.8.0 H10d,
 * docs/design/worker-deployment.md §1.3): its relay drafts the answer and
 * publishes over `pg_notify`, which reaches the subscription below in this
 * process, so the run stays in the background and the reader can rejoin it.
 */
import {
  type CopilotEvent,
  callAction,
  copilotStepFrom,
  copilotThreadChannel,
  eventReasonFields,
  reasonSentence,
  streamAnswer,
} from "@openokr/core";
import type { NextRequest } from "next/server";
import { getPool } from "../../../lib/auth";
import { outboxDrained } from "../../../lib/background-work";
import { resolveDrafterFor } from "../../../lib/drafter";
import { getRealtime } from "../../../lib/realtime";
import { refuseCrossSite } from "../../../lib/same-origin";
import { requireWorkspace } from "../../../lib/workspace";

/** The reason the panel words from its catalogue when the stream itself fails. */
const couldNotAnswer = { code: "could_not_answer" } as const;

export const dynamic = "force-dynamic";

interface AskBody {
  readonly question: string;
  readonly threadId?: string;
  readonly subjectType?: string;
  readonly subjectId?: string;
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

/**
 * The shape only, not the rules.
 *
 * `copilot.ask` parses its own input with the schema the registry declares, so
 * length, format and the both-or-neither anchor rule are enforced there once
 * rather than twice with two chances to disagree. This turns a JSON body into
 * arguments, and refuses one with no question in it.
 *
 * `zod` deliberately not imported: it is not a dependency of this application
 * package, and adding one to restate a schema that already exists would be the
 * wrong trade.
 */
function parseBody(value: unknown): AskBody | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const question = text(raw.question);
  if (!question) {
    return null;
  }
  return {
    question,
    ...(text(raw.threadId) ? { threadId: text(raw.threadId) as string } : {}),
    ...(text(raw.subjectType)
      ? { subjectType: text(raw.subjectType) as string }
      : {}),
    ...(text(raw.subjectId)
      ? { subjectId: text(raw.subjectId) as string }
      : {}),
  };
}

export async function POST(request: NextRequest) {
  const crossSite = refuseCrossSite(request);
  if (crossSite) {
    return crossSite;
  }
  let workspaceId: string;
  let userId: string;
  try {
    const { session, workspace } = await requireWorkspace();
    workspaceId = workspace.workspaceId;
    userId = session.user.id;
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const asked = parseBody(await request.json().catch(() => null));
  if (!asked) {
    // The boundary refuses bad input before anything is written (§8.2).
    return new Response("Bad request", { status: 400 });
  }

  const pool = getPool();

  if (outboxDrained()) {
    return backgroundRun(pool, workspaceId, userId, asked, request.signal);
  }

  // No drafter means AI is off, which the panel renders as its own state
  // rather than as a failure. `streamAnswer` still records the question and
  // still returns the passages retrieval found, and says why with the reason
  // the chain stopped on (plan 0.8.0 O1).
  const outcome = await resolveDrafterFor(workspaceId, "balanced", userId, {
    source: "copilot",
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: CopilotEvent) => {
        // openokr:allow-side-effect: this writes bytes to the HTTP response
        // body, not to a driver or a queue.
        controller.enqueue(
          encoder.encode(
            `event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`,
          ),
        );
      };

      try {
        for await (const event of streamAnswer(
          {
            pool,
            workspaceId,
            actor: { kind: "human", userId },
            ...("drafter" in outcome
              ? { drafter: outcome.drafter }
              : { aiOff: outcome.off }),
          },
          { workspaceId, ...asked },
          request.signal,
        )) {
          send(event);
        }
      } catch (error) {
        // The question may already be recorded, so the panel is told the answer
        // failed rather than left waiting. The message is deliberately generic:
        // a provider error can carry a key.
        if (!request.signal.aborted) {
          send({
            kind: "unavailable",
            reason: reasonSentence(couldNotAnswer),
            ...couldNotAnswer,
          });
          send({ kind: "done", answerMessageId: null, stopped: true });
        }
        void error;
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Records the question, enqueues the run, and streams what it publishes.
 *
 * The events are the same `CopilotEvent` shapes the inline path sends, so the
 * panel reads one protocol whichever produced them. `thread` comes from the
 * write here rather than from the job, because the reader needs the thread id
 * to reattach to before any prose exists.
 */
async function backgroundRun(
  pool: ReturnType<typeof getPool>,
  workspaceId: string,
  userId: string,
  asked: AskBody,
  signal: AbortSignal,
): Promise<Response> {
  let started: Awaited<ReturnType<typeof callAction<"copilot.ask">>>;
  try {
    started = await callAction(
      { pool, workspaceId, actor: { kind: "human", userId } },
      "copilot.ask",
      { ...asked, background: true },
    );
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const channel = copilotThreadChannel(workspaceId, started.threadId);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: CopilotEvent) => {
        // openokr:allow-side-effect: this writes bytes to the HTTP response
        // body, not to a driver or a queue.
        controller.enqueue(
          encoder.encode(
            `event: ${event.kind}
data: ${JSON.stringify(event)}

`,
          ),
        );
      };

      send({
        kind: "thread",
        threadId: started.threadId,
        questionMessageId: started.messageId,
        // So the panel can stop the run (plan 0.8.1 W4).
        ...(started.answerMessageId
          ? { answerMessageId: started.answerMessageId }
          : {}),
      });

      const subscription = await getRealtime().subscribe(
        channel,
        (
          event: import("@openokr/adapters").RealtimeEvent<
            Record<string, unknown>
          >,
        ) => {
          const data = event.data ?? {};
          if (event.name === "copilot.sources") {
            send({
              kind: "sources",
              sources: (data.sources ?? []) as never,
            });
            return;
          }
          if (event.name === "copilot.text") {
            send({ kind: "text", text: String(data.text ?? "") });
            return;
          }
          if (event.name === "copilot.step") {
            const step = copilotStepFrom(data);
            if (step) {
              send({ kind: "step", ...step });
            }
            return;
          }
          if (event.name === "copilot.proposal") {
            const proposalId = data.proposalId;
            if (typeof proposalId === "string" && proposalId !== "") {
              send({ kind: "proposal", proposalId });
            }
            return;
          }
          if (event.name === "copilot.done") {
            const halted = data.haltedReason;
            if (typeof halted === "string" && halted !== "") {
              send({
                kind: "unavailable",
                reason: halted,
                ...eventReasonFields(data),
              });
            }
            send({
              kind: "done",
              answerMessageId: started.answerMessageId,
              stopped: data.stopped === true,
            });
            controller.close();
          }
        },
      );

      // **Closing the tab does not stop the run.** That is the point of the
      // row: the subscription goes and the job carries on writing into the
      // message the reader can come back to.
      const stop = () => {
        subscription.unsubscribe().catch(() => undefined);
      };
      signal.addEventListener("abort", stop);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
