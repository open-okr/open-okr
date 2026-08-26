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
 */
import { type CopilotEvent, streamAnswer } from "@openokr/core";
import type { NextRequest } from "next/server";
import { getPool } from "../../../lib/auth";
import { drafterFor } from "../../../lib/drafter";
import { requireWorkspace } from "../../../lib/workspace";

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
  // Null means the provider is off, which the panel renders as its own state
  // rather than as a failure. `streamAnswer` still records the question and
  // still returns the passages retrieval found.
  const drafter = await drafterFor(workspaceId);

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
            ...(drafter ? { drafter } : {}),
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
            reason: "The copilot could not answer. Your question was saved.",
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
