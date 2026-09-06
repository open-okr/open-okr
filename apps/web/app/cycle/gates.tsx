import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  VerdictDot,
} from "@openokr/ui";
import { ActionForm } from "./action-form.tsx";
import { publishCycle } from "./actions.ts";

/**
 * The six publish gates (METHOD.md §4.5, UIUX-PLAN.md §4 S-10).
 *
 * A gate whose input does not exist yet is drawn as "cannot be judged", not as
 * red and not as green. That is the honest third state: it blocks publication the
 * same way a red gate does, and telling a facilitator to go fix something that
 * has not been built would waste their time.
 *
 * The publish button re-evaluates on the server before it commits. What the
 * screen shows is a snapshot, and the refusal it may come back with is the
 * authority.
 *
 * **Every unmet gate links at what would fix it** (P4-T03). A checklist that
 * says "gate 4 is red" and stops has told a facilitator the one thing they
 * already knew from the dot. The destinations are phases and screens rather
 * than fields, because a gate is a property of the whole set: gate 4 is the
 * dependency register, gate 5 is the capacity check, gate 6 is the cycle's own
 * dates.
 */

/** Where the work that clears each gate actually happens. Exported so a test
 * can assert no gate sends a facilitator to a screen that cannot clear it. */
export const FIX: Record<
  number,
  { readonly href: string; readonly label: string }
> = {
  1: { href: "/cycle?phase=4", label: "Name the champion and reviewer" },
  2: { href: "/cycle?phase=4", label: "Open the quality panel" },
  3: { href: "/goals/studio", label: "Map the alignment" },
  // The register is on this page, so the link is an anchor to it rather than a
  // second visit to the address the reader is already at. It pointed at
  // `/cycle?phase=5` from P4-T03 until P6-G17, which meant gate 4's remedy was
  // "go where you already are", and nothing there could confirm anything.
  4: { href: "#dependency-register", label: "Confirm the dependencies" },
  // An anchor for the same reason gate 4 is: the capacity check renders on
  // this page, and gate-remedies.test.ts refuses a remedy that navigates to the
  // address the panel is already at.
  5: { href: "#capacity-check", label: "Check the capacity" },
  6: { href: "/admin/rhythm", label: "Set the publication date" },
};
export interface Gate {
  readonly gateKey: number;
  readonly title: string;
  readonly passed: boolean;
  readonly evaluable: boolean;
  readonly missing: readonly string[];
  readonly blocked: string | null;
}

export function Gates({
  cycleId,
  gates,
  publishable,
  publishedAt,
  canPublish,
}: {
  readonly cycleId: string;
  readonly gates: readonly Gate[];
  readonly publishable: boolean;
  readonly publishedAt: string | null;
  readonly canPublish: boolean;
}) {
  const green = gates.filter((gate) => gate.evaluable && gate.passed).length;

  return (
    <Card>
      <CardHeader className="justify-between">
        <h2 className="text-sm font-bold text-ink">Publish gates</h2>
        <Chip tone={publishable ? "ok" : "warn"}>{green} of 6 green</Chip>
      </CardHeader>
      <CardBody className="flex flex-col gap-3.5">
        <ul className="flex flex-col divide-y divide-line">
          {gates.map((gate) => (
            <li
              key={gate.gateKey}
              className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0"
            >
              <VerdictDot
                className="mt-1.5"
                state={!gate.evaluable ? "todo" : gate.passed ? "pass" : "fail"}
                label={
                  !gate.evaluable
                    ? `Gate ${gate.gateKey} cannot be judged yet`
                    : gate.passed
                      ? `Gate ${gate.gateKey} is green`
                      : `Gate ${gate.gateKey} is red`
                }
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm text-ink">
                  {gate.gateKey}. {gate.title}
                </span>
                {gate.evaluable ? (
                  gate.missing.length > 0 ? (
                    <ul className="flex flex-col gap-0.5 text-xs text-bad">
                      {gate.missing.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  ) : null
                ) : (
                  <span className="text-xs text-ink-3">
                    Cannot be judged yet: {gate.blocked}
                  </span>
                )}
                {gate.evaluable && gate.passed ? null : (
                  <a
                    href={FIX[gate.gateKey]?.href ?? "/cycle?phase=4"}
                    className="w-fit text-xs font-semibold text-brand-text hover:underline"
                  >
                    {FIX[gate.gateKey]?.label ?? "Go to the drafting screen"}
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>

        {publishedAt ? (
          <p className="text-sm text-ok">
            Published {new Date(publishedAt).toLocaleString()}.
          </p>
        ) : canPublish ? (
          <ActionForm action={publishCycle} className="flex flex-col gap-1.5">
            <input type="hidden" name="cycleId" value={cycleId} />
            <Button type="submit" variant="primary" disabled={!publishable}>
              Publish the set
            </Button>
            {publishable ? null : (
              <p className="text-xs text-ink-3">
                All six gates have to be green. A gate nobody can judge counts
                against publication.
              </p>
            )}
          </ActionForm>
        ) : null}

        {publishedAt || !canPublish || publishable ? null : (
          <details className="rounded-md border border-line p-2.5">
            <summary className="cursor-pointer text-xs font-semibold text-ink-2">
              Publish anyway, past the red gates
            </summary>
            <ActionForm
              action={publishCycle}
              className="mt-2 flex flex-col gap-1.5"
            >
              <input type="hidden" name="cycleId" value={cycleId} />
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ink-2">
                  Why is this set being published with{" "}
                  {
                    gates.filter((gate) => !gate.evaluable || !gate.passed)
                      .length
                  }{" "}
                  gate
                  {gates.filter((gate) => !gate.evaluable || !gate.passed)
                    .length === 1
                    ? ""
                    : "s"}{" "}
                  unmet?
                </span>
                <textarea
                  name="override.reason"
                  required
                  minLength={20}
                  rows={3}
                  className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
                  placeholder="The reason somebody will read six months from now"
                />
              </label>
              <Button type="submit">Override and publish</Button>
              <p className="text-xs text-ink-4">
                This writes an audit event naming you, the reason and every gate
                that was unmet. Twenty characters minimum, because an override
                with no reason is indistinguishable from a bug.
              </p>
            </ActionForm>
          </details>
        )}

        {publishedAt || canPublish ? null : (
          <p className="text-xs text-ink-3">
            Publishing is a workspace administrator's call.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
