import {
  ALIGNMENT_CHECKS,
  CYCLE_CHECKS,
  describeRule,
  examplesFor,
  KEY_RESULT_CHECKS,
  methodSectionAnchor,
  OBJECTIVE_CHECKS,
  type QualityCheck,
  type QualityExample,
  TRIGGER_CATALOGUE,
  type Trigger,
} from "@openokr/method";
import { AgentFace, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { faceForTrigger } from "../../../lib/agent-moods.ts";
import { methodDocumentUrl } from "../../../lib/app-version";
import { nameOf, TRIGGER_NAME_KEYS } from "../../../lib/identifier-names.ts";
import { pageTitle } from "../../../lib/page-title.ts";
import { getTranslations } from "../../../lib/translations";

export const generateMetadata = pageTitle("pageTitle.methodRule");

/** Where METHOD.md sets a check out, as `describeRule` places it. */
const checkSection = (id: string): string => describeRule(id)?.section ?? "4";

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

/** The catalogue key naming each group, read through `t` where it renders. */
const GROUP_LABEL: Record<QualityCheck["group"], string> = {
  objective: "method.detail.objectiveCheck",
  key_result: "method.detail.keyResultCheck",
  alignment: "method.detail.alignmentCheck",
  cycle: "method.detail.cycleCheck",
};

const TONE = {
  pass: "ok",
  info: "neutral",
  warn: "warn",
  fail: "bad",
  todo: "neutral",
} as const;

export default async function RulePage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { t } = await getTranslations();

  const { id } = await params;
  const wanted = decodeURIComponent(id).toLowerCase();
  const check = ALL.find((entry) => entry.id.toLowerCase() === wanted);
  if (!check) {
    // Not a §4 check, so it may be a §6.4 trigger. Every nudge links here by
    // its rule key, and a link from a coaching message that lands on a
    // not-found is the product failing its own hard rule: a message cites a
    // rule that resolves.
    const fired = TRIGGER_CATALOGUE.find(
      (entry) => entry.key.toLowerCase() === wanted,
    );
    if (fired) {
      return <TriggerPage trigger={fired} />;
    }
    notFound();
  }
  const examples = examplesFor(check.id);

  return (
    <div className="flex w-full flex-col gap-3.5">
      <Card>
        <CardHeader className="justify-between">
          <div className="flex min-w-0 flex-col">
            <h1 className="text-lg font-bold text-ink">
              {check.id} · {check.title}
            </h1>
            <p className="text-xs text-ink-3">{t(GROUP_LABEL[check.group])}</p>
            {/* This page is the rule in full as the product runs it. The
                link is for the reasoning and sources around it, in the
                METHOD.md the running release shipped. */}
            <a
              href={methodDocumentUrl(
                methodSectionAnchor(checkSection(check.id)) ?? undefined,
              )}
              target="_blank"
              rel="noreferrer"
              data-testid="rule-method-link"
              className="mt-1 text-xs font-semibold text-brand-text underline"
            >
              {t("methodHint.readMore")}
              <span className="sr-only"> {t("methodHint.opensInNewTab")}</span>
            </a>
          </div>
          <Chip tone={check.feedsStrengthScore ? "info" : "neutral"}>
            {check.feedsStrengthScore
              ? t("method.detail.countsTowardsTheStrengthScore")
              : t("method.detail.feedsThePublishGates")}
          </Chip>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-bold text-ink">
            {t("method.detail.howItJudgesIn")}
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

      <ExamplePairs examples={examples} />

      <Card>
        <CardBody>
          <p className="text-xs text-ink-3">
            {t("method.detail.firstMatchWinsThe")}
          </p>
          <Link
            href="/cycle"
            className="mt-2 inline-block text-xs font-semibold text-brand-text hover:underline"
          >
            {t("method.detail.backToTheCycle")}
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}

/**
 * METHOD.md §4.6's weak and strong pairs for one rule, or nothing.
 *
 * On a trigger's page as well as a check's since 0.7.0 (plan M1): the
 * committed-objective pair belongs to `quality.committed_floor`, which is a
 * rule rather than one of the twenty-six checks.
 */
async function ExamplePairs({
  examples,
}: {
  readonly examples: readonly QualityExample[];
}) {
  if (examples.length === 0) {
    return null;
  }
  const { t } = await getTranslations();
  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-bold text-ink">
          {t("method.detail.weakAndStrongMethod")}
        </h2>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {examples.map((pair) => (
          <div key={pair.weak} className="flex flex-col gap-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border border-bad/40 bg-bad-bg p-2">
                <p className="text-[0.65rem] font-bold uppercase tracking-wide text-bad">
                  {t("common.weak")}
                </p>
                <p className="text-sm text-ink">{pair.weak}</p>
              </div>
              <div className="rounded-md border border-ok/40 bg-ok-bg p-2">
                <p className="text-[0.65rem] font-bold uppercase tracking-wide text-ok">
                  {t("common.strong")}
                </p>
                <p className="text-sm text-ink">{pair.strong}</p>
              </div>
            </div>
            <p className="text-xs text-ink-3">{pair.why}</p>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

/**
 * A §6.4 trigger, rather than a §4 check.
 *
 * The two are both "rules" to a reader and both cited by rule key, so they both
 * live here. What differs is what there is to say: a check has condition rows
 * and a trigger has a condition, a recipient and whether it survives the AI
 * provider being off.
 */
async function TriggerPage({ trigger }: { readonly trigger: Trigger }) {
  const { t } = await getTranslations();
  const owner =
    trigger.owner === "coach"
      ? t("method.detail.okrCoach")
      : t("method.detail.okrChampion");
  // The face the message wears in the inbox, so the two read as one sender.
  const face = faceForTrigger(trigger.key);

  return (
    <div className="flex w-full flex-col gap-3.5">
      <Card>
        <CardHeader className="justify-between">
          <div className="flex min-w-0 items-center gap-3">
            {face ? (
              <AgentFace
                agent={face.agent}
                mood={face.mood}
                className="size-9"
              />
            ) : null}
            <div className="flex min-w-0 flex-col">
              {/* The rule's name, with the key it is cited by under it: "See
               * the rule" opened on the bare key (usability review D8). */}
              <h1 className="text-lg font-bold text-ink">
                {nameOf(TRIGGER_NAME_KEYS, trigger.key, t)}
              </h1>
              <p className="font-mono text-xs text-ink-4">{trigger.key}</p>
              <p className="text-xs text-ink-3">
                {t("method.detail.proactiveMessageAiNativePlan", {
                  Champion: owner,
                })}
              </p>
            </div>
          </div>
          <Chip tone={trigger.escalates ? "warn" : "neutral"}>
            {trigger.escalates
              ? t("method.detail.climbsALadder")
              : t("method.detail.doesNotEscalate")}
          </Chip>
        </CardHeader>
        <CardBody className="flex flex-col gap-2">
          <p className="text-sm text-ink">
            <span className="font-semibold text-ink-2">
              {t("method.detail.fires")}{" "}
            </span>
            {trigger.fires}
          </p>
          <p className="text-sm text-ink">
            <span className="font-semibold text-ink-2">
              {t("method.detail.goesTo")}{" "}
            </span>
            {trigger.recipient}
          </p>
          <p className="text-xs text-ink-3">
            {trigger.deterministic
              ? t("method.detail.firesWithTheAiProviderOff")
              : t("method.detail.needsTheAiProvider")}
          </p>
        </CardBody>
      </Card>

      <ExamplePairs examples={examplesFor(trigger.key)} />

      <Card>
        <CardBody>
          <p className="text-xs text-ink-3">
            {t("method.detail.everyProactiveMessageThe")}
          </p>
          <Link
            href="/review"
            className="mt-2 inline-block text-xs font-semibold text-brand-text hover:underline"
          >
            {t("method.detail.backToWhatYou")}
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
