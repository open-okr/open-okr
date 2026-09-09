"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  useTranslations,
} from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  buildDemo,
  finishOnboarding,
  inviteSomebody,
  saveBasics,
  saveRhythm,
} from "./actions.ts";

/**
 * The four steps a first sign-in walks through (screen S-34, P6-G26).
 *
 * **Every step is skippable, and skipping is not a lesser path.** §4.14 says
 * every setting has a working default and nothing must be configured before
 * the product works, and provisioning has already resolved all of them. So the
 * wizard asks four questions whose answers a workspace already has, and
 * "Skip" is the answer that keeps them. The acceptance line is exactly this:
 * skip every step and land on a working workspace at every documented default.
 *
 * **A client component holding one step at a time**, rather than four routes.
 * The state is which question is on screen and nothing else; a route per step
 * would put a half-finished setup in the browser's history and let somebody
 * arrive at step three by typing.
 *
 * **The last step ends it whichever button is pressed.** Finishing and
 * skipping the last question are the same act as far as the workspace is
 * concerned: the wizard has been offered and is done. What differs is whether
 * the demo was built.
 */

const STEPS = ["basics", "rhythm", "people", "demo"] as const;
type Step = (typeof STEPS)[number];

const FREQUENCIES = [
  { value: "weekly", key: "welcome.rhythm.weekly" },
  { value: "biweekly", key: "welcome.rhythm.biweekly" },
  { value: "monthly", key: "welcome.rhythm.monthly" },
] as const;

export function Wizard({
  workspaceName,
  timezone,
}: {
  readonly workspaceName: string;
  /** The timezone provisioning resolved from the registering browser. */
  readonly timezone: string;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const [step, setStep] = useState<Step>("basics");
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  const [name, setName] = useState(workspaceName);
  const [zone, setZone] = useState(timezone);
  const [frequency, setFrequency] =
    useState<(typeof FREQUENCIES)[number]["value"]>("weekly");
  const [email, setEmail] = useState("");

  const index = STEPS.indexOf(step);

  const advance = (work: () => Promise<{ error: string | null }>) => {
    setProblem(null);
    start(async () => {
      const result = await work();
      if (result.error) {
        setProblem(result.error);
        return;
      }
      const next = STEPS[index + 1];
      if (next) {
        setStep(next);
        return;
      }
      // The end. Mark it done and leave, so the redirect that sent us here
      // stops sending anybody here.
      const done = await finishOnboarding();
      if (done.error) {
        setProblem(done.error);
        return;
      }
      router.push("/");
      router.refresh();
    });
  };

  const skip = () => advance(async () => ({ error: null }));

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col">
          <h1 className="text-lg font-bold text-ink">{t("common.title")}</h1>
          <p className="text-xs text-ink-3">{t("welcome.explains")}</p>
          {/* The counter is digits and a slash, which is the same in every
              language; the catalogue names it for a screen reader instead. */}
          <p className="mt-1 text-xs text-ink-4" data-testid="welcome-progress">
            <span className="sr-only">{t("welcome.progress")}</span>
            {`${index + 1} / ${STEPS.length}`}
          </p>
        </div>
      </CardHeader>

      <CardBody className="flex flex-col gap-3.5">
        {step === "basics" ? (
          <div className="flex flex-col gap-2.5" data-testid="step-basics">
            <label className="flex flex-col gap-1 text-xs text-ink-3">
              {t("welcome.basics.name")}
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-3">
              {t("welcome.basics.timezone")}
              <input
                value={zone}
                onChange={(event) => setZone(event.target.value)}
                className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
              />
              <span className="text-ink-4">
                {t("welcome.basics.timezoneHelp")}
              </span>
            </label>
          </div>
        ) : null}

        {step === "rhythm" ? (
          <div className="flex flex-col gap-2.5" data-testid="step-rhythm">
            <span className="text-xs text-ink-3">
              {t("welcome.rhythm.question")}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {FREQUENCIES.map((one) => (
                <button
                  key={one.value}
                  type="button"
                  data-testid={`frequency-${one.value}`}
                  aria-pressed={frequency === one.value}
                  onClick={() => setFrequency(one.value)}
                  className={
                    frequency === one.value
                      ? "rounded-md border border-brand-600 bg-brand px-2.5 py-1 text-xs font-semibold text-on-brand"
                      : "rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-ink-2 hover:border-ink-4"
                  }
                >
                  {t(one.key)}
                </button>
              ))}
            </div>
            <span className="text-xs text-ink-4">
              {t("welcome.rhythm.help")}
            </span>
          </div>
        ) : null}

        {step === "people" ? (
          <div className="flex flex-col gap-2.5" data-testid="step-people">
            <label className="flex flex-col gap-1 text-xs text-ink-3">
              {t("welcome.people.invite")}
              <input
                type="email"
                value={email}
                placeholder={t("welcome.people.placeholder")}
                onChange={(event) => setEmail(event.target.value)}
                className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
              />
              <span className="text-ink-4">{t("welcome.people.help")}</span>
            </label>
          </div>
        ) : null}

        {step === "demo" ? (
          <div className="flex flex-col gap-2.5" data-testid="step-demo">
            <span className="text-xs text-ink-3">
              {t("welcome.demo.question")}
            </span>
            <span className="text-xs text-ink-4">{t("welcome.demo.help")}</span>
          </div>
        ) : null}

        {problem ? (
          <span role="alert" className="text-xs text-bad">
            {problem}
          </span>
        ) : null}

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="primary"
            disabled={pending}
            data-testid="welcome-continue"
            onClick={() => {
              if (step === "basics") {
                advance(() => saveBasics({ name, timezone: zone }));
              } else if (step === "rhythm") {
                advance(() =>
                  saveRhythm({ defaultCheckInFrequency: frequency }),
                );
              } else if (step === "people") {
                advance(() => inviteSomebody({ email }));
              } else {
                advance(buildDemo);
              }
            }}
          >
            {step === "demo" ? t("welcome.demo.build") : t("welcome.continue")}
          </Button>
          <Button
            type="button"
            disabled={pending}
            data-testid="welcome-skip"
            onClick={skip}
          >
            {step === "demo" ? t("welcome.demo.empty") : t("common.skip")}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
