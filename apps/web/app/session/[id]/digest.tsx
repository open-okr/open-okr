"use client";

/**
 * The weekly digest (METHOD.md §7.2 step 4, screen S-22, P4-T15b-a).
 *
 * **The lines are the digest. The prose is optional.** `sessions.digest` renders
 * §7.2's six parts with no provider involved, and that is what a self-hosted
 * workspace without an API key reads. When a provider can answer, the narration
 * appears above the lines and the lines stay: a reader who wants the numbers
 * should never have to trust a paragraph for them.
 *
 * **A narration that states a figure nobody measured never arrives here.** The
 * action checks every number in the prose against the numbers it computed and
 * answers null when one was invented, so this component has no judgement to make
 * about whether to trust what it was given.
 */
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { Sparkles } from "lucide-react";
import { useCallback, useState } from "react";
import { narrateDigestAction } from "./actions";

export interface WeeklyDigest {
  readonly weekStart: string;
  readonly lines: readonly string[];
}

export function Digest({
  sessionId,
  digest,
  assistAvailable,
}: {
  readonly sessionId: string;
  /** Null before step 4 has produced one. */
  readonly digest: WeeklyDigest | null;
  /** Whether a provider can narrate at all. False is the normal case. */
  readonly assistAvailable: boolean;
}) {
  const [narrative, setNarrative] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const narrate = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await narrateDigestAction(sessionId);
      setNarrative(result?.narrative ?? null);
      if (!result) {
        // Either the model declined or it stated a figure the product did not
        // compute. Both end here, and the lines below are unaffected.
        setNotice("No narration this time. The digest below is the digest.");
      }
    } catch {
      setNotice("The assist could not run. The digest below is unaffected.");
    } finally {
      setBusy(false);
    }
  }, [sessionId]);

  if (!digest) {
    return (
      <Card>
        <CardHeader>Digest</CardHeader>
        <CardBody>
          <p className="text-sm text-ink-3">
            The digest is assembled when the session reaches step 4.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="justify-between">
        <span>Digest, week of {digest.weekStart}</span>
        {assistAvailable ? (
          <Button variant="ai" disabled={busy} onClick={() => void narrate()}>
            <Sparkles className="size-3" />
            Narrate it
          </Button>
        ) : null}
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {narrative ? (
          <section
            aria-label="Narrated digest"
            className="rounded-md border border-line bg-surface p-3"
          >
            <span className="mb-1.5 flex items-center gap-2">
              <Chip tone="agent">AI</Chip>
              <span className="text-xs text-ink-4">
                Same numbers, fewer lines
              </span>
            </span>
            <p className="text-sm text-ink">{narrative}</p>
          </section>
        ) : null}

        <ul aria-label="The digest" className="flex flex-col gap-1.5">
          {digest.lines.map((line) => (
            <li key={line} className="text-sm text-ink-2">
              {line}
            </li>
          ))}
        </ul>

        {notice ? <p className="text-xs text-ink-4">{notice}</p> : null}
      </CardBody>
    </Card>
  );
}
