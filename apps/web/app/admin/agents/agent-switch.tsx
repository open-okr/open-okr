"use client";

import { Button } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { cancelRunAction, setAgentEnabledAction } from "./actions";

/**
 * Turning an agent off, and stopping a run (P6-G13a).
 *
 * **`setEnabled` and `cancelRun` shipped at P2-T17 with no caller.** So an
 * agent saying the wrong thing could only be silenced from the command line,
 * and a run working through a list it should not have started could only be
 * waited out. Both are the controls CLAUDE.md's rules assume exist.
 *
 * **Disabling is not deleting**, and the label says which. Turning an agent off
 * keeps its bindings, its persona and its run history; deleting it would throw
 * away the least-privilege scope somebody set on purpose and the record of what
 * it has already said.
 */
export function AgentSwitch({
  id,
  enabled,
  name,
}: {
  readonly id: string;
  readonly enabled: boolean;
  readonly name: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      size="sm"
      variant={enabled ? "ghost" : "primary"}
      disabled={pending}
      onClick={() => {
        if (
          enabled &&
          !window.confirm(
            `Turn ${name} off? It stops speaking and keeps its scope, its persona and its run log. Nothing it already said is undone.`,
          )
        ) {
          return;
        }
        start(async () => {
          await setAgentEnabledAction(id, !enabled);
          router.refresh();
        });
      }}
    >
      {pending ? "Working…" : enabled ? "Turn off" : "Turn on"}
    </Button>
  );
}

/** Stops a run that is still planning or running (P6-G13a). */
export function CancelRun({ id }: { readonly id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        start(async () => {
          await cancelRunAction(id);
          router.refresh();
        });
      }}
    >
      {pending ? "Stopping…" : "Stop"}
    </Button>
  );
}
