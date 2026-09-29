import { aiEgressTargetOf } from "@openokr/adapters";
import {
  AI_CONTEXT_EGRESS_LEVELS,
  type AIContextEgressLevel,
  type AIPrivacySettings,
  ASSIST_FEATURE_KEYS,
  REVIEW_ASSIST_KEYS,
  RHYTHM_ASSIST_KEYS,
} from "@openokr/core";
import {
  type AIProviderKind,
  BUDGET_METRICS,
  BUDGET_PERIODS,
  BUDGET_SCOPES,
  MODEL_TIERS,
} from "@openokr/db";
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import {
  ASSIST_NAME_KEYS,
  PROMPT_NAME_KEYS,
} from "../../../lib/identifier-names.ts";
import { getTranslations } from "../../../lib/translations";
import {
  removeBudget,
  restoreDefaultPrompt,
  saveBudget,
  saveFeature,
  savePrivacy,
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

/**
 * A stored prompt's name, or its key when it has none (P8-G11d).
 *
 * A prompt is a row a workspace stores rather than a fixed list, so an unknown
 * key is normal here and falls back to itself rather than failing a test.
 */
function promptName(promptKey: string, t: (key: string) => string): string {
  const named = PROMPT_NAME_KEYS[promptKey];
  return named === undefined ? promptKey : t(named);
}

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
            {t("admin.ai.governance.spendLastDays", { days })}
          </h2>
          <p className="text-xs text-ink-3">
            {t("admin.ai.governance.meteredFromTheEvent")}
          </p>
        </div>
        {usage.flaggedCalls > 0 ? (
          <Chip tone="warn">
            {t("admin.ai.governance.flagged", {
              flaggedCalls: usage.flaggedCalls,
            })}
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
          const named = ASSIST_NAME_KEYS[featureKey];
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
                {/*
                 * The assist's name, not its key (P8-G11d). The key is still
                 * the hidden field this form posts, so nothing about what is
                 * stored or authorised changed.
                 */}
                <span className="text-sm">
                  {named === undefined ? featureKey : t(named)}
                </span>
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
              {/*
               * A prompt is a row a workspace stores rather than a fixed list,
               * so an unknown key is normal here and falls back to itself.
               */}
              <span className="font-medium">
                {promptName(prompt.promptKey, t)}
              </span>
              {prompt.isDefault ? (
                <Chip tone="neutral">{t("admin.ai.governance.builtIn")}</Chip>
              ) : (
                <Chip tone="info">
                  {t("admin.ai.governance.version", {
                    version: prompt.version,
                  })}
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
                  {t("admin.ai.governance.earlierVersionS", {
                    length: prompt.history.length,
                  })}
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

/**
 * Whether anything this workspace sends can leave its network.
 *
 * `unconfigured` when no tier routes anywhere, `local` when every tier that
 * does routes to a provider at localhost or a private address, and `remote`
 * otherwise. Only `local` greys the card out, as AI-NATIVE-PLAN §4 asks: with
 * nothing configured yet, an administrator may still decide in advance.
 */
export type EgressState = "unconfigured" | "local" | "remote";

/**
 * The egress state from the tier routes and the provider configuration.
 *
 * **A row counts only when it is the one a call would use.** The host that
 * builds a provider reads this workspace's row when it is enabled and holds
 * a key, or is Ollama, which needs none (`resolveAICredential`). Any other
 * route answers through the deployment's own key, whose address this page
 * does not see, so it counts as remote. The card is greyed out only when every
 * answer is known to stay: a disabled row at localhost must not make the card
 * say nothing leaves while the deployment's remote provider answers.
 */
export function egressStateOf(
  routes: readonly { readonly provider: string | null }[],
  providers: readonly {
    readonly provider: AIProviderKind;
    readonly baseUrl: string | null;
    readonly enabled: boolean;
    readonly hasWorkspaceCredential: boolean;
  }[],
): EgressState {
  const answering = routes.flatMap((route) =>
    route.provider === null ? [] : [route.provider],
  );
  if (answering.length === 0) {
    return "unconfigured";
  }
  const local = answering.every((kind) => {
    const config = providers.find((one) => one.provider === kind);
    if (!config?.enabled) {
      return false;
    }
    const used = config.hasWorkspaceCredential || config.provider === "ollama";
    return used && aiEgressTargetOf(config.provider, config.baseUrl).local;
  });
  return local ? "local" : "remote";
}

/** Catalogue keys for each level's name and what it means. */
const LEVEL_WORDS: Readonly<
  Record<
    AIContextEgressLevel,
    { readonly label: string; readonly help: string }
  >
> = {
  all: {
    label: "admin.ai.privacy.levelAll",
    help: "admin.ai.privacy.levelAllHelp",
  },
  assists: {
    label: "admin.ai.privacy.levelAssists",
    help: "admin.ai.privacy.levelAssistsHelp",
  },
  none: {
    label: "admin.ai.privacy.levelNone",
    help: "admin.ai.privacy.levelNoneHelp",
  },
};

/**
 * The privacy and egress card (AI-NATIVE-PLAN §4, completeness review M-10).
 *
 * **It was three paragraphs of static text**, one of which was not true: it
 * said an assist sends only what it drafts from, while the copilot sent its
 * passages and the search index sent every item's text, and nothing an
 * administrator could touch changed any of it. Each control here is enforced
 * around every provider the product builds, in `packages/adapters`, so what
 * the card says is what the call path does.
 *
 * **Every sentence names its limit.** Redaction covers addresses and numbers
 * and says names are sent. No-training names the one provider that takes the
 * instruction and says what decides for the rest. A reader who trusts this
 * card should not be surprised by what it did not say.
 */
export async function PrivacyCard({
  privacy,
  egress,
}: {
  /** As `ai.readPrivacySettings` returns them. */
  readonly privacy: AIPrivacySettings;
  readonly egress: EgressState;
}) {
  const { t } = await getTranslations();
  const local = egress === "local";

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">
            {t("admin.ai.governance.privacyAndEgress")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("admin.ai.privacy.whatMayLeave")}
          </p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {egress === "unconfigured" ? (
          <p className="text-xs text-ink-3">
            {t("admin.ai.governance.withNoProviderConfigured")}
          </p>
        ) : null}
        {local ? (
          <p className="rounded-md border border-info-dot bg-info-bg px-2.5 py-1.5 text-xs text-info">
            {t("admin.ai.privacy.zeroEgress")}
          </p>
        ) : null}

        <AIForm action={savePrivacy}>
          {/* Greyed out rather than hidden on a local provider: the settings
              are still stored and apply the moment a remote one is routed. */}
          <fieldset
            disabled={local}
            className="flex flex-col gap-3 disabled:opacity-60"
          >
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-xs font-semibold text-ink-2">
                {t("admin.ai.privacy.contextLevel")}
              </legend>
              {AI_CONTEXT_EGRESS_LEVELS.map((level) => (
                <label key={level} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="contextEgress"
                    value={level}
                    defaultChecked={privacy.contextEgress === level}
                    className="mt-0.5 size-4"
                  />
                  <span className="flex flex-col">
                    <span className="text-ink">
                      {t(LEVEL_WORDS[level].label)}
                    </span>
                    <span className="text-xs text-ink-3">
                      {t(LEVEL_WORDS[level].help)}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="redactPersonalData"
                defaultChecked={privacy.redactPersonalData}
                className="mt-0.5 size-4"
              />
              <span className="flex flex-col">
                <span className="text-ink">{t("admin.ai.privacy.redact")}</span>
                <span className="text-xs text-ink-3">
                  {t("admin.ai.privacy.redactHelp")}
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="noTraining"
                defaultChecked={privacy.noTraining}
                className="mt-0.5 size-4"
              />
              <span className="flex flex-col">
                <span className="text-ink">
                  {t("admin.ai.privacy.noTraining")}
                </span>
                <span className="text-xs text-ink-3">
                  {t("admin.ai.privacy.noTrainingHelp")}
                </span>
              </span>
            </label>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="ai-privacy-hosts"
                className="text-xs font-semibold text-ink-2"
              >
                {t("admin.ai.privacy.allowedHosts")}
              </label>
              <textarea
                id="ai-privacy-hosts"
                name="allowedHosts"
                rows={3}
                defaultValue={privacy.allowedHosts.join("\n")}
                placeholder={t("admin.ai.privacy.allowedHostsPlaceholder")}
                aria-describedby="ai-privacy-hosts-help"
                className="rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-xs text-ink"
              />
              <p id="ai-privacy-hosts-help" className="text-xs text-ink-3">
                {t("admin.ai.privacy.allowedHostsHelp")}
              </p>
            </div>

            <div>
              <Button type="submit" variant="default" size="sm">
                {t("common.save")}
              </Button>
            </div>
          </fieldset>
        </AIForm>

        <div className="flex flex-col gap-1.5 border-t border-line pt-3 text-xs text-ink-3">
          <p>{t("admin.ai.privacy.localExempt")}</p>
          <p>{t("admin.ai.privacy.fromNowOn")}</p>
          <p>{t("admin.ai.privacy.recorded")}</p>
          <p>{t("admin.ai.privacy.keysAtRest")}</p>
          <p>{t("admin.ai.governance.aBaseUrlOn")}</p>
        </div>
      </CardBody>
    </Card>
  );
}
