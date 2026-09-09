import {
  ASSIST_FEATURE_KEYS,
  REVIEW_ASSIST_KEYS,
  RHYTHM_ASSIST_KEYS,
} from "@openokr/core";
import {
  BUDGET_METRICS,
  BUDGET_PERIODS,
  BUDGET_SCOPES,
  MODEL_TIERS,
} from "@openokr/db";
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { getTranslations } from "../../../lib/translations";
import {
  removeBudget,
  restoreDefaultPrompt,
  saveBudget,
  saveFeature,
  savePrompt,
} from "./actions.ts";
import { AIForm } from "./ai-form.tsx";

/**
 * The AI console's second half: features, prompts, budgets and usage
 * (UIUX-PLAN.md §6 S-37, P6-G12b).
 *
 * **Its own module because the console is one screen, not two.** P6-G12a built
 * the provider, the keys and the models; this is what makes the cost and the
 * behaviour visible and bounded. Splitting them across two routes would ask an
 * administrator to remember which half holds the switch they want, so they sit
 * on one page and the file is split instead.
 *
 * **Every switch here turns off an assist, never a path.** An assist drafts
 * wording for something the product already does deterministically, so a
 * feature turned off leaves the manual path exactly as it was. That is why the
 * copy names the manual path rather than warning about lost capability.
 *
 * **A budget disables rather than fails.** Crossing one stops the AI call and
 * leaves everything deterministic untouched; a run already in progress halts
 * with the reason written into its own log, which is what makes a hard cap
 * answerable afterwards rather than mysterious.
 */

const TIER_WORDS: Readonly<Record<string, string>> = {
  fast: "Fast",
  balanced: "Balanced",
  deep: "Deep",
  embed: "Embedding",
};

/**
 * Every assist that has a switch, in the three groups §2 puts them in.
 *
 * Enumerated from the three key maps rather than written out, so an assist
 * added next month appears on this screen without anybody remembering it
 * exists.
 */
const FEATURE_KEYS: readonly string[] = [
  ...Object.values(ASSIST_FEATURE_KEYS),
  ...Object.values(REVIEW_ASSIST_KEYS),
  ...Object.values(RHYTHM_ASSIST_KEYS),
];

export interface FeatureSetting {
  readonly featureKey: string;
  readonly enabled: boolean;
  readonly tierOverride: string | null;
}

export interface Budget {
  readonly id: string;
  readonly scope: string;
  readonly scopeRef: string | null;
  readonly metric: string;
  readonly period: string;
  readonly limitValue: number;
}

export interface UsageSummary {
  readonly totalCalls: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCost: number;
  readonly flaggedCalls: number;
}

export interface PromptRow {
  readonly promptKey: string;
  readonly version: number;
  readonly systemPrompt: string;
  readonly isDefault: boolean;
  readonly history: readonly {
    readonly version: number;
    readonly createdAt: string;
  }[];
}

export async function UsageCard({
  usage,
  days,
}: {
  readonly usage: UsageSummary;
  readonly days: number;
}) {
  const { t } = await getTranslations();

  const figures: readonly (readonly [string, string])[] = [
    ["Calls", usage.totalCalls.toLocaleString("en-GB")],
    ["Tokens in", usage.totalInputTokens.toLocaleString("en-GB")],
    ["Tokens out", usage.totalOutputTokens.toLocaleString("en-GB")],
    ["Cost", `${usage.totalCost.toFixed(2)} USD`],
  ];
  return (
    <Card>
      <CardHeader className="justify-between">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">
            {t("admin.ai.governance.spendLast")} {days}{" "}
            {t("admin.ai.governance.days")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("admin.ai.governance.meteredFromTheEvent")}
          </p>
        </div>
        {usage.flaggedCalls > 0 ? (
          <Chip tone="warn">
            {usage.flaggedCalls} {t("admin.ai.governance.flagged")}
          </Chip>
        ) : (
          <Chip tone="ok">{t("admin.ai.governance.nothingFlagged")}</Chip>
        )}
      </CardHeader>
      <CardBody className="flex flex-wrap gap-6">
        {figures.map(([label, value]) => (
          <div key={label} className="flex flex-col">
            <span className="text-lg font-bold tabular-nums text-ink">
              {value}
            </span>
            <span className="text-xs text-ink-3">{label}</span>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

export async function BudgetsCard({
  budgets,
}: {
  readonly budgets: readonly Budget[];
}) {
  const { t } = await getTranslations();

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">
            {t("admin.ai.governance.budgetsAndCaps")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("admin.ai.governance.crossingOneStopsThe")}
          </p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-2.5">
        {budgets.length === 0 ? (
          <p className="text-xs text-ink-3">
            {t("admin.ai.governance.noneSetSoNothing")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-ink-3">
                <tr>
                  <th className="py-1 pr-3 font-semibold">
                    {t("common.scope")}
                  </th>
                  <th className="py-1 pr-3 font-semibold">
                    {t("admin.ai.governance.metric")}
                  </th>
                  <th className="py-1 pr-3 font-semibold">
                    {t("common.period")}
                  </th>
                  <th className="py-1 pr-3 font-semibold">
                    {t("admin.ai.governance.limit")}
                  </th>
                  <th className="py-1 font-semibold" />
                </tr>
              </thead>
              <tbody className="text-ink-2">
                {budgets.map((budget) => (
                  <tr key={budget.id} className="border-t border-line">
                    <td className="py-1.5 pr-3 text-ink">
                      {budget.scope}
                      {budget.scopeRef ? (
                        <span className="ml-1.5 font-mono text-ink-3">
                          {budget.scopeRef.slice(0, 8)}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1.5 pr-3">{budget.metric}</td>
                    <td className="py-1.5 pr-3">{budget.period}</td>
                    <td className="py-1.5 pr-3 tabular-nums">
                      {budget.limitValue}
                    </td>
                    <td className="py-1.5">
                      <AIForm action={removeBudget}>
                        <input type="hidden" name="id" value={budget.id} />
                        <Button type="submit" variant="ghost" size="sm">
                          {t("common.remove")}
                        </Button>
                      </AIForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <AIForm
          action={saveBudget}
          className="flex flex-wrap items-end gap-2 border-t border-line pt-3"
        >
          <label className="flex flex-col gap-1 text-xs text-ink-3">
            {t("common.scope")}
            <select
              name="scope"
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            >
              {BUDGET_SCOPES.map((scope) => (
                <option key={scope} value={scope}>
                  {scope}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-3">
            {t("admin.ai.governance.whoseForAUser")}
            <input
              name="scopeRef"
              placeholder={t("admin.ai.governance.leaveEmptyForThe")}
              className="w-64 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-3">
            {t("admin.ai.governance.metric")}
            <select
              name="metric"
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            >
              {BUDGET_METRICS.map((metric) => (
                <option key={metric} value={metric}>
                  {metric}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-3">
            {t("common.period")}
            <select
              name="period"
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            >
              {BUDGET_PERIODS.map((period) => (
                <option key={period} value={period}>
                  {period}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-3">
            {t("admin.ai.governance.limit")}
            <input
              name="limitValue"
              type="number"
              min={0}
              step="0.01"
              required
              className="w-32 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <Button type="submit" variant="default" size="sm">
            {t("common.set")}
          </Button>
        </AIForm>
      </CardBody>
    </Card>
  );
}

export async function FeaturesCard({
  features,
}: {
  readonly features: readonly FeatureSetting[];
}) {
  const { t } = await getTranslations();

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">
            {t("admin.ai.governance.features")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("admin.ai.governance.eachAssistOnIts")}
          </p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-1.5">
        {FEATURE_KEYS.map((featureKey) => {
          const setting = features.find((one) => one.featureKey === featureKey);
          return (
            <AIForm
              key={featureKey}
              action={saveFeature}
              className="flex flex-wrap items-center gap-2.5 border-t border-line pt-2 first:border-0 first:pt-0"
            >
              <input type="hidden" name="featureKey" value={featureKey} />
              <label className="flex min-w-64 items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={setting?.enabled ?? true}
                  className="size-4"
                />
                <code className="font-mono text-xs">{featureKey}</code>
              </label>
              <label className="flex items-center gap-1.5 text-xs text-ink-3">
                {t("admin.ai.governance.tier")}
                <select
                  name="tierOverride"
                  defaultValue={setting?.tierOverride ?? ""}
                  className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink"
                >
                  <option value="">
                    {t("admin.ai.governance.whateverTheAssistAsks")}
                  </option>
                  {MODEL_TIERS.map((tier) => (
                    <option key={tier} value={tier}>
                      {TIER_WORDS[tier] ?? tier}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="ghost" size="sm">
                {t("common.save")}
              </Button>
            </AIForm>
          );
        })}
      </CardBody>
    </Card>
  );
}

export async function PromptsCard({
  prompts,
}: {
  readonly prompts: readonly PromptRow[];
}) {
  const { t } = await getTranslations();

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">
            {t("admin.ai.governance.prompts")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("admin.ai.governance.everyEditIsA")}
          </p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {prompts.map((prompt) => (
          <div
            key={prompt.promptKey}
            className="flex flex-col gap-1.5 border-t border-line pt-3 first:border-0 first:pt-0"
          >
            <span className="flex items-center gap-2 text-sm text-ink">
              <code className="font-mono text-xs">{prompt.promptKey}</code>
              {prompt.isDefault ? (
                <Chip tone="neutral">{t("admin.ai.governance.builtIn")}</Chip>
              ) : (
                <Chip tone="info">
                  {t("admin.ai.governance.version")} {prompt.version}
                </Chip>
              )}
            </span>
            <AIForm action={savePrompt} className="flex flex-col gap-1.5">
              <input type="hidden" name="promptKey" value={prompt.promptKey} />
              <textarea
                name="systemPrompt"
                rows={4}
                defaultValue={prompt.systemPrompt}
                className="rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-xs text-ink"
              />
              <Button type="submit" variant="ghost" size="sm">
                {t("admin.ai.governance.saveANewVersion")}
              </Button>
            </AIForm>
            {prompt.isDefault ? null : (
              <AIForm action={restoreDefaultPrompt}>
                <input
                  type="hidden"
                  name="promptKey"
                  value={prompt.promptKey}
                />
                <Button type="submit" variant="ghost" size="sm">
                  {t("admin.ai.governance.restoreTheBuiltIn")}
                </Button>
              </AIForm>
            )}
            {prompt.history.length > 0 ? (
              <details className="text-xs text-ink-3">
                <summary className="cursor-pointer">
                  {prompt.history.length}{" "}
                  {t("admin.ai.governance.earlierVersionS")}
                </summary>
                <ul className="mt-1 flex flex-col gap-1">
                  {prompt.history.map((entry) => (
                    <li key={entry.version}>
                      v{entry.version}, {entry.createdAt.slice(0, 10)}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

export async function PrivacyCard() {
  const { t } = await getTranslations();

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-bold text-ink">
          {t("admin.ai.governance.privacyAndEgress")}
        </h2>
      </CardHeader>
      <CardBody className="flex flex-col gap-1.5 text-xs text-ink-3">
        <p>{t("admin.ai.governance.withNoProviderConfigured")}</p>
        <p>{t("admin.ai.governance.withOneConfiguredAn")}</p>
        <p>{t("admin.ai.governance.aBaseUrlOn")}</p>
      </CardBody>
    </Card>
  );
}
