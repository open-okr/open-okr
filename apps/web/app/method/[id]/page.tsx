import {
  ALIGNMENT_CHECKS,
  CYCLE_CHECKS,
  examplesFor,
  KEY_RESULT_CHECKS,
  OBJECTIVE_CHECKS,
  type QualityCheck,
} from "@openokr/method";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShellLayout } from "../../../lib/app-shell.tsx";

/**
 * One rule, as METHOD.md defines it (P4-T02b).
 *
 * Every verdict in the product links here, which is the deliverable's "a link
 * from every verdict to the rule itself". A coaching message that cannot be
 * traced back to its rule is an opinion, and the whole point of the catalogue
 * is that it is not one.
 *
 * The page renders the catalogue rather than restating METHOD.md, so it cannot
 * disagree with what actually fired. The conditions are shown in evaluation
 * order, first match wins, because a reader trying to work out why they got
 * this verdict and not the next one needs the order to make sense of it.
 */

const ALL: readonly QualityCheck[] = [
  ...OBJECTIVE_CHECKS,
  ...KEY_RESULT_CHECKS,
  ...ALIGNMENT_CHECKS,
  ...CYCLE_CHECKS,
];

const GROUP_LABEL: Record<QualityCheck["group"], string> = {
  objective: "Objective check (METHOD.md §4.1)",
  key_result: "Key result check (METHOD.md §4.2)",
  alignment: "Alignment check (METHOD.md §4.3)",
  cycle: "Cycle check (METHOD.md §4.4)",
};

const TONE = {
  pass: "ok",
  warn: "warn",
  fail: "bad",
  todo: "neutral",
} as const;

export default async function RulePage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;
  const check = ALL.find(
    (entry) => entry.id.toLowerCase() === decodeURIComponent(id).toLowerCase(),
  );
  if (!check) {
    notFound();
  }
  const examples = examplesFor(check.id);

  return (
    <AppShellLayout>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3.5">
        <Card>
          <CardHeader className="justify-between">
            <div className="flex min-w-0 flex-col">
              <h1 className="text-lg font-bold text-ink">
                {check.id} · {check.title}
              </h1>
              <p className="text-xs text-ink-3">{GROUP_LABEL[check.group]}</p>
            </div>
            <Chip tone={check.feedsStrengthScore ? "info" : "neutral"}>
              {check.feedsStrengthScore
                ? "counts towards the strength score"
                : "feeds the publish gates"}
            </Chip>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">
              How it judges, in order
            </h2>
          </CardHeader>
          <CardBody className="p-0">
            <ul className="flex flex-col">
              {check.conditions.map((row) => (
                <li
                  key={row.condition}
                  className="flex flex-col gap-1 border-line border-b p-3 last:border-b-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={TONE[row.status]} dot>
                      {row.status}
                    </Chip>
                    <span className="text-sm font-semibold text-ink">
                      {row.condition}
                    </span>
                  </div>
                  <p className="text-sm text-ink-2">{row.prompt}</p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        {examples.length > 0 ? (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">
                Weak and strong (METHOD.md §4.6)
              </h2>
            </CardHeader>
            <CardBody className="flex flex-col gap-3">
              {examples.map((pair) => (
                <div key={pair.weak} className="flex flex-col gap-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-md border border-bad/40 bg-bad-weak p-2">
                      <p className="text-[0.65rem] font-bold uppercase tracking-wide text-bad-text">
                        Weak
                      </p>
                      <p className="text-sm text-ink">{pair.weak}</p>
                    </div>
                    <div className="rounded-md border border-ok/40 bg-ok-weak p-2">
                      <p className="text-[0.65rem] font-bold uppercase tracking-wide text-ok-text">
                        Strong
                      </p>
                      <p className="text-sm text-ink">{pair.strong}</p>
                    </div>
                  </div>
                  <p className="text-xs text-ink-3">{pair.why}</p>
                </div>
              ))}
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardBody>
            <p className="text-xs text-ink-3">
              First match wins: the conditions are tested in the order above and
              the first that holds is the verdict. Every rule in this catalogue
              is METHOD.md §4, and a build fails when the two disagree.
            </p>
            <Link
              href="/cycle"
              className="mt-2 inline-block text-xs font-semibold text-brand-text hover:underline"
            >
              Back to the cycle
            </Link>
          </CardBody>
        </Card>
      </div>
    </AppShellLayout>
  );
}
