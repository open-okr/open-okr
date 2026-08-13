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
 */
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
        ) : (
          <p className="text-xs text-ink-3">
            Publishing is a workspace administrator's call.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
