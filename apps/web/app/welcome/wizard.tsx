"use client";

import { isEmailAddress } from "@openokr/formats";
import type { CheckInFrequency } from "@openokr/method";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmailInput,
  TextInput,
  TimezoneSelect,
  useTranslations,
} from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  applyStartingTemplate,
  buildDemo,
  finishOnboarding,
  inviteSomebody,
  saveBasics,
  saveRhythm,
} from "./actions.ts";

/**
 * The five steps a first sign-in walks through (screen S-34, P6-G26, P8-T12).
 *
 * **Every step is skippable, and skipping is not a lesser path.** §4.14 says
 * every setting has a working default and nothing must be configured before
 * the product works, and provisioning has already resolved all of them. So the
 * wizard asks questions whose answers a workspace already has, and "Skip" is
 * the answer that keeps them. The acceptance line is exactly this: skip every
 * step and land on a working workspace at every documented default.
 *
 * **The count on screen is `STEPS.length`, never a word in the catalogue**
 * (completeness review L-08). The introduction said "Four questions" above a
 * "1 / 5" counter from the day P8-T12 added the template step, because the
 * sentence and the list were two places to change and only one was changed.
 *
 * **It opens on what the workspace holds now**, which is also what makes it
 * safe to offer again from General in admin (L-08). The name, the timezone and
 * the rhythm arrive from the page rather than from constants, so pressing
 * Continue on a reopened wizard writes back the answer already given instead
 * of the default.
 *
 * **A client component holding one step at a time**, rather than five routes.
 * The state is which question is on screen and nothing else; a route per step
 * would put a half-finished setup in the browser's history and let somebody
 * arrive at step three by typing.
 *
 * **The last step ends it whichever button is pressed.** Finishing and
 * skipping the last question are the same act as far as the workspace is
 * concerned: the wizard has been offered and is done. What differs is whether
 * the demo was built.
 */

const STEPS = ["basics", "rhythm", "people", "template", "demo"] as const;
type Step = (typeof STEPS)[number];

/**
 * The starting templates, and the fourth answer (P8-T12).
 *
 * Skipping is the fourth answer rather than a missing one: §4.14 says every
 * step is skippable and skipping is not a lesser path, so the empty workspace
 * is offered as plainly as the three templates are.
 */
const STARTING_TEMPLATES = [
  {
    value: "starter",
    key: "welcome.template.starter",
    help: "welcome.template.starterHelp",
  },
  {
    value: "company-onboarding",
    key: "welcome.template.company",
    help: "welcome.template.companyHelp",
  },
  {
    value: "product-team",
    key: "welcome.template.product",
    help: "welcome.template.productHelp",
  },
] as const;

const FREQUENCIES = [
  { value: "weekly", key: "welcome.rhythm.weeklyRecommended" },
  { value: "biweekly", key: "welcome.rhythm.biweekly" },
  { value: "monthly", key: "welcome.rhythm.monthly" },
] as const;

/** The time now on a zone's clock, so the reader can tell the zone is theirs. */
function localTimeIn(zone: string): string | null {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: zone,
    }).format(new Date());
  } catch {
    return null;
  }
}

export function Wizard({
  workspaceName,
  timezone,
  zones,
  frequency: currentFrequency,
}: {
  readonly workspaceName: string;
  /** The workspace's timezone: the registering browser's, or a later answer. */
  readonly timezone: string;
  /** The server's own list, so the wizard offers only what it will accept. */
  readonly zones: readonly string[];
  /**
   * The rhythm the workspace runs now. Weekly on a first run, which is the
   * method's own default; whatever was chosen since on a reopened one. It may
   * be one the three buttons do not offer, and then none is pressed and
   * Continue keeps it.
   */
  readonly frequency: CheckInFrequency;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const [step, setStep] = useState<Step>("basics");
  const [pending, start] = useTransition();
  // Continue or Skip started the step in flight, so only that one spins.
  const [acting, setActing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const [name, setName] = useState(workspaceName);
  const [zone, setZone] = useState(timezone);
  const [frequency, setFrequency] =
    useState<CheckInFrequency>(currentFrequency);
  const [email, setEmail] = useState("");
  const [template, setTemplate] = useState<
    (typeof STARTING_TEMPLATES)[number]["value"] | "none"
  >("starter");

  const index = STEPS.indexOf(step);

  const advance = (
    name: string,
    work: () => Promise<{ error: string | null }>,
  ) => {
    setProblem(null);
    setActing(name);
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

  const skip = () => advance("skip", async () => ({ error: null }));

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col">
          <h1 className="text-lg font-bold text-ink">{t("common.title")}</h1>
          <p className="text-xs text-ink-3">
            {t("welcome.explains", { count: STEPS.length })}
          </p>
          {/* "Step 1 of 5" and a bar, both from the list's own length
              (usability review W1). */}
          <p className="mt-1 text-xs text-ink-3" data-testid="welcome-progress">
            {t("welcome.stepOf", { step: index + 1, total: STEPS.length })}
          </p>
          <div
            role="progressbar"
            aria-label={t("welcome.progress")}
            aria-valuemin={1}
            aria-valuemax={STEPS.length}
            aria-valuenow={index + 1}
            className="mt-1.5 h-1 w-full max-w-60 overflow-hidden rounded-full bg-raised"
          >
            <div
              className="h-full rounded-full bg-brand"
              style={{ width: `${((index + 1) / STEPS.length) * 100}%` }}
            />
          </div>
        </div>
      </CardHeader>

      <CardBody className="flex flex-col gap-3.5">
        {step === "basics" ? (
          <div className="flex flex-col gap-2.5" data-testid="step-basics">
            <TextInput
              label={t("welcome.basics.name")}
              value={name}
              // The rename action's own limit, so the box stops where the
              // server would.
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
            />
            <TimezoneSelect
              label={t("welcome.basics.timezone")}
              description={t("welcome.basics.timezoneHelp")}
              zones={zones}
              value={zone}
              onValueChange={(chosen) => setZone(chosen ?? "")}
            />
            {/* The clock it keeps, so a wrong zone shows before it is saved
                (usability review W1). Continue stays enabled: every step
                is skippable (UIUX-PLAN S-34). */}
            {zone && localTimeIn(zone) ? (
              <span className="text-xs text-ink-3" data-testid="local-time">
                {t("welcome.basics.localTime", {
                  time: localTimeIn(zone) ?? "",
                })}
              </span>
            ) : null}
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
                      ? "min-h-11 rounded-md border border-brand-600 bg-brand px-3.5 text-sm font-semibold text-on-brand"
                      : "min-h-11 rounded-md border border-line px-3.5 text-sm font-semibold text-ink-2 hover:border-ink-4"
                  }
                >
                  {t(one.key)}
                </button>
              ))}
            </div>
            <span className="text-xs text-ink-3">
              {t("welcome.rhythm.help")}
            </span>
          </div>
        ) : null}

        {step === "people" ? (
          <div className="flex flex-col gap-2.5" data-testid="step-people">
            <EmailInput
              label={t("welcome.people.invite")}
              description={t("welcome.people.help")}
              value={email}
              placeholder={t("welcome.people.placeholder")}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
        ) : null}

        {step === "template" ? (
          <div className="flex flex-col gap-2.5" data-testid="step-template">
            <span className="text-xs text-ink-3">
              {t("welcome.template.question")}
            </span>
            {/* One choice of three, so radios rather than three toggles
                (usability review W4). */}
            <fieldset
              aria-label={t("welcome.template.question")}
              className="flex flex-col gap-1.5"
            >
              {STARTING_TEMPLATES.map((one) => (
                <label
                  key={one.value}
                  data-testid={`template-${one.value}`}
                  className="flex cursor-pointer items-start gap-2.5 rounded-md border border-line px-2.5 py-2 hover:border-ink-4 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-weak"
                >
                  <input
                    type="radio"
                    name="template"
                    value={one.value}
                    checked={template === one.value}
                    onChange={() => setTemplate(one.value)}
                    className="mt-0.5 size-4 flex-none accent-brand"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-xs font-semibold text-ink">
                      {t(one.key)}
                    </span>
                    <span className="text-xs text-ink-3">{t(one.help)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <span className="text-xs text-ink-3">
              {t("welcome.template.help")}
            </span>
          </div>
        ) : null}

        {step === "demo" ? (
          <div className="flex flex-col gap-2.5" data-testid="step-demo">
            <span className="text-xs text-ink-3">
              {t("welcome.demo.question")}
            </span>
            <span className="text-xs text-ink-3">{t("welcome.demo.help")}</span>
          </div>
        ) : null}

        {problem ? (
          <span role="alert" className="text-xs text-bad">
            {problem}
          </span>
        ) : null}

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Back from step 2 on: nothing is lost, each step already saved
              its answer or kept the default (usability review W2). */}
          {index > 0 ? (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              data-testid="welcome-back"
              onClick={() => {
                setProblem(null);
                const previous = STEPS[index - 1];
                if (previous) {
                  setStep(previous);
                }
              }}
            >
              {t("welcome.back")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="primary"
            disabled={pending}
            pending={pending && acting === "continue"}
            data-testid="welcome-continue"
            onClick={() => {
              if (step === "basics") {
                advance("continue", () => saveBasics({ name, timezone: zone }));
              } else if (step === "rhythm") {
                advance("continue", () =>
                  saveRhythm({ defaultCheckInFrequency: frequency }),
                );
              } else if (step === "people") {
                // These fields are not in a form, so the browser never
                // stops a malformed address on its own. Asked here with the
                // server's own rule, before anything is sent.
                const address = email.trim();
                if (address !== "" && !isEmailAddress(address)) {
                  setProblem(t("fields.email.invalid"));
                  return;
                }
                advance("continue", () => inviteSomebody({ email: address }));
              } else if (step === "template") {
                advance("continue", () => applyStartingTemplate({ template }));
              } else {
                advance("continue", buildDemo);
              }
            }}
          >
            {step === "demo"
              ? t("welcome.demo.build")
              : step === "template"
                ? t("welcome.template.apply")
                : step === "people" && email.trim() !== ""
                  ? t("welcome.people.inviteAndContinue")
                  : t("welcome.continue")}
          </Button>
          <Button
            type="button"
            disabled={pending}
            pending={pending && acting === "skip"}
            data-testid="welcome-skip"
            onClick={skip}
          >
            {step === "demo"
              ? t("welcome.demo.finish")
              : step === "template"
                ? t("welcome.template.empty")
                : t("welcome.skipForNow")}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
