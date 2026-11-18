import {
  ACCESS_LEVELS,
  callAction,
  knownPromptKeys,
  readHostedAccess,
} from "@openokr/core";
import { AI_PROVIDER_KINDS, MODEL_TIERS } from "@openokr/db";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  IdentifierInput,
  NumberInput,
  SecretInput,
  SelectInput,
  TextInput,
} from "@openokr/ui";
import Link from "next/link";
import { resolveAccessLevelFor } from "../../../lib/access";
import { resolveDrafterFor } from "../../../lib/drafter";
import { pageTitle } from "../../../lib/page-title.ts";
import { getPool } from "../../../lib/pool";
import { latestEvaluations } from "../../../lib/prompt-evaluation.ts";
import { getKeyRing } from "../../../lib/secrets";
import { getTranslations } from "../../../lib/translations";
import { requireWorkspace } from "../../../lib/workspace";
import {
  addModel,
  clearTier,
  removeModel,
  removeWorkspaceKey,
  rotateKeys,
  saveWorkspaceKey,
  testWorkspaceKeyAction,
} from "./actions.ts";
import { AddCard } from "./add-card.tsx";
import { AgentCallsCard } from "./agent-calls-card";
import { AIForm } from "./ai-form.tsx";
import { tierModelValue } from "./choices.ts";
import {
  BudgetsCard,
  egressStateOf,
  FeaturesCard,
  PrivacyCard,
  PromptsCard,
  UsageCard,
} from "./governance.tsx";
import { ProviderSettingsForm } from "./provider-settings-form.tsx";
import { ProviderTabs } from "./provider-tabs.tsx";
import { RatingsCard, type RatingsFilter } from "./ratings-card";
import { TierRouteForm } from "./tier-route-form.tsx";

export const generateMetadata = pageTitle("pageTitle.adminAi");

/**
 * The AI console: provider, keys and models (UIUX-PLAN.md §6 S-37, P6-G12a).
 *
 * **Twenty-four registered actions and not one caller.** The provider
 * configuration, the envelope-encrypted credentials, the rotation, the model
 * catalogue and the tier routing were all built across P2-T13, P2-T14 and
 * P4-T14 and no screen ever reached any of them. An instance could be given a
 * provider key only by calling an action directly, which means every
 * self-hosted deployment shipped with AI permanently off. The gap audit
 * recorded it as B-05, the largest blocker on the list.
 *
 * **No key is ever rendered back.** It is envelope-encrypted on the way in and
 * this page shows a masked hint and a status, which is what AI-NATIVE-PLAN §3.3
 * asks for. There is no field pre-filled with the current key "so you can check
 * it", because that would be a screen that displays a provider key.
 *
 * **Stored is not verified, and the card says which.** A key that has been
 * pasted has been pasted; whether the provider accepts it is a different fact
 * and the status column carries it. A green tick earned by typing a string is
 * the kind of reassurance that costs somebody a support hour later, and the
 * channels card refuses to give it for the same reason.
 *
 * **Everything here works with the provider off**, because the product does.
 * Turning AI off leaves every deterministic path untouched, so this screen
 * disables nothing and hides nothing: it is the screen you use to turn it on.
 */

/** Catalogue keys, so a tier and a provider are named in the reader's language. */
const TIER_WORDS: Readonly<Record<string, string>> = {
  fast: "admin.ai.tierFast",
  balanced: "admin.ai.tierBalanced",
  deep: "admin.ai.tierDeep",
  embed: "admin.ai.tierEmbed",
};

const PROVIDER_WORDS: Readonly<Record<string, string>> = {
  anthropic: "admin.ai.providerAnthropic",
  openai: "admin.ai.providerOpenai",
  google: "admin.ai.providerGoogle",
  openrouter: "admin.ai.providerOpenrouter",
  ollama: "admin.ai.providerOllama",
  "openai-compatible": "admin.ai.providerOpenaiCompatible",
};

/** The model capabilities a custom entry can declare, with their labels. */
const CAPABILITIES = [
  ["supportsTools", "admin.ai.capabilityTools"],
  ["supportsVision", "admin.ai.capabilityVision"],
  ["supportsJsonMode", "admin.ai.capabilityJsonMode"],
  ["supportsStreaming", "admin.ai.capabilityStreaming"],
] as const;

/**
 * How far back the spend figures look.
 *
 * Thirty days, which is what a monthly budget is measured against and the
 * shortest window that shows a trend rather than a morning.
 */
const USAGE_WINDOW_DAYS = 30;

const STATUS_TONE: Readonly<Record<string, "ok" | "bad" | "warn">> = {
  verified: "ok",
  invalid: "bad",
  unverified: "warn",
};

/**
 * The ratings list's place in the address: `ratings=down|up` narrows it and
 * `before=<time>_<id>` is the last row of the page before (plan 0.9.0 FB1).
 */
function ratingsQuery(params: Record<string, string | undefined>): {
  readonly filter: RatingsFilter;
  readonly cursor?: { readonly at: string; readonly id: string };
} {
  const filter =
    params.ratings === "down" || params.ratings === "up"
      ? params.ratings
      : "all";
  const [at, id] = (params.before ?? "").split("_");
  const valid =
    at !== undefined &&
    id !== undefined &&
    /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(at) &&
    /^[0-9a-f-]{36}$/i.test(id);
  return { filter, ...(valid ? { cursor: { at, id } } : {}) };
}

export default async function AdminAIPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { t } = await getTranslations();
  const ratingsParams = ratingsQuery(await searchParams);
  // A value the schema adds before the catalogue knows it is shown as itself
  // rather than hidden.
  const tierWord = (tier: string): string => {
    const key = TIER_WORDS[tier];
    return key ? t(key) : tier;
  };
  const providerWord = (provider: string): string => {
    const key = PROVIDER_WORDS[provider];
    return key ? t(key) : provider;
  };

  const { session, workspace } = await requireWorkspace();
  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );

  if (level < ACCESS_LEVELS.full) {
    // Said rather than hidden. A provider key books spend against the whole
    // workspace, so somebody who cannot set one should still know the product
    // has AI and who to ask for it.
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-bold text-ink">{t("common.ai")}</h1>
        <Card>
          <CardBody>
            <p className="text-sm text-ink-2">
              {t("admin.ai.configuringTheAiProvider")}
            </p>
            <p className="mt-1 text-xs text-ink-3">
              {t("admin.ai.everyCheckInScore")}
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
    ring: getKeyRing(),
  };
  const hosted = await readHostedAccess(getPool(), workspace.workspaceId);

  const since = new Date(
    Date.now() - USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [
    providers,
    models,
    routes,
    features,
    budgets,
    usage,
    prompts,
    privacy,
    directory,
    agents,
  ] = await Promise.all([
    callAction(context, "ai.readProviderConfig", {}),
    callAction(context, "ai.readModelCatalog", {}),
    callAction(context, "ai.readTierRouting", {}),
    callAction(context, "ai.readFeatureSettings", {}),
    callAction(context, "ai.readBudgets", {}),
    callAction(context, "ai.readUsageSummary", { since }),
    Promise.all(
      knownPromptKeys().map((promptKey) =>
        callAction(context, "ai.readPrompt", { promptKey }),
      ),
    ),
    callAction(context, "ai.readPrivacySettings", {}),
    // Whose a budget can be: a person, by member id, or an agent.
    callAction(context, "people.directory", {}),
    callAction(context, "agents.list", {}),
  ]);

  // The usage card's latest evaluation results (plan 0.7.0 A9): each prompt's
  // current version against its set, computed now against the mock.
  const evaluations = await latestEvaluations(prompts);

  const configured = providers.filter((one) => one.hasWorkspaceCredential);
  // A cloud workspace whose plan carries no AI credits and that has no key of
  // its own: the plan is why AI is off (plan 0.8.0 O1).
  const planIsWhy = hosted.kind === "none" && configured.length === 0;
  // What a tier can route to: every model the catalogue holds active.
  const modelChoices = models
    .filter((model) => model.active)
    .map((model) => ({
      id: tierModelValue(model.provider, model.modelId),
      label: model.displayName,
      detail: `${providerWord(model.provider)} · ${model.modelId}`,
    }));

  return (
    <div className="flex flex-col gap-4.5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-lg font-bold text-ink">{t("common.ai")}</h1>
          <p className="max-w-prose text-sm text-ink-3">
            {t("admin.ai.everyRuleScoreGate")}
          </p>
          {hosted.kind === "credits" ? (
            <p className="max-w-prose text-sm text-ink-2">
              {t("admin.credits.ownKey")}
            </p>
          ) : null}
          {/* A cloud workspace whose plan carries no AI credits and that has
              no key of its own has no AI at all, while this page used to say
              only "not configured" (plan 0.8.0 O1). Say why, and where. */}
          {planIsWhy ? (
            <p
              className="max-w-prose text-sm text-warn"
              data-testid="ai-plan-without-credits"
            >
              {t("admin.ai.planWithoutCredits")}{" "}
              <Link className="underline" href="/admin/plan">
                {t("admin.ai.choosePlan")}
              </Link>
            </p>
          ) : null}
        </div>
        {/* Beside the plan's sentence, "not configured" repeated the reason
            O1 replaced (UAT 0.8.0 F-09). */}
        {planIsWhy ? null : (
          <Chip tone={configured.length > 0 ? "ok" : "neutral"}>
            {configured.length > 0
              ? t("admin.ai.configuredCount", { count: configured.length })
              : t("admin.ai.notConfigured")}
          </Chip>
        )}
      </header>

      <section
        aria-label={t("admin.ai.providers")}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-xs font-semibold tracking-wide text-ink-4 uppercase">
            {t("admin.ai.providersAndKeys")}
          </h2>
          <p className="max-w-prose text-xs text-ink-3">
            {t("admin.ai.providersIntro")}
          </p>
        </div>
        <ProviderTabs
          label={t("admin.ai.providers")}
          tabs={AI_PROVIDER_KINDS.map((kind) => {
            const config = providers.find((one) => one.provider === kind);
            const chips = (
              <>
                {config?.enabled ? (
                  <Chip tone="ok">{t("admin.ai.on")}</Chip>
                ) : (
                  <Chip tone="neutral">{t("admin.ai.off")}</Chip>
                )}
                {config?.hasWorkspaceCredential && config.workspaceKeyStatus ? (
                  <Chip tone={STATUS_TONE[config.workspaceKeyStatus] ?? "warn"}>
                    {config.workspaceKeyStatus}
                  </Chip>
                ) : null}
              </>
            );
            return {
              kind,
              label: providerWord(kind),
              chips,
              panel: (
                <Card data-testid={`ai-provider-${kind}`}>
                  <CardHeader className="justify-between">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                        {providerWord(kind)}
                        {chips}
                      </span>
                      <p className="text-xs text-ink-3">
                        {t("admin.ai.providerCardIntro")}
                      </p>
                    </div>
                    {config?.workspaceKeyHint ? (
                      <code className="font-mono text-xs text-ink-3">
                        {config.workspaceKeyHint}
                      </code>
                    ) : null}
                  </CardHeader>
                  <div className="flex flex-col gap-3 p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-ink-3">
                        {t("admin.ai.keyHeading")}
                      </p>
                      <span className="text-xs text-ink-4">
                        {t("common.appliesAtOnce")}
                      </span>
                    </div>
                    {/* The server refuses a key for a provider with no
                        configuration row, and the row is made by saving the
                        settings below. Say so instead of offering a Store that
                        can only fail. */}
                    {config ? null : (
                      <p
                        id={`ai-key-needs-provider-${kind}`}
                        className="text-xs text-ink-3"
                      >
                        {t("admin.ai.keyNeedsProvider")}
                      </p>
                    )}
                    <AIForm
                      action={saveWorkspaceKey}
                      className="grid grid-cols-12 items-end gap-x-6 gap-y-2"
                    >
                      <input type="hidden" name="provider" value={kind} />
                      <SecretInput
                        className="col-span-12 md:col-span-9"
                        label={
                          config?.hasWorkspaceCredential
                            ? t("admin.ai.replaceTheKeyHelp")
                            : t("admin.ai.pasteTheProviderKey")
                        }
                        name="apiKey"
                        // A provider key, never the member's own password: stop
                        // the browser and password managers offering logins.
                        autoComplete="new-password"
                        data-1p-ignore
                        data-lpignore="true"
                        data-bwignore
                        data-form-type="other"
                        required
                        maxLength={4096}
                        disabled={!config}
                      />
                      <div className="col-span-12 md:col-span-3">
                        <Button
                          type="submit"
                          variant="default"
                          size="sm"
                          className="w-full"
                          disabled={!config}
                          aria-describedby={
                            config ? undefined : `ai-key-needs-provider-${kind}`
                          }
                        >
                          {config?.hasWorkspaceCredential
                            ? t("admin.ai.replace")
                            : t("admin.ai.store")}
                        </Button>
                      </div>
                    </AIForm>
                    {config?.hasWorkspaceCredential ? (
                      <div className="flex flex-wrap items-start gap-2">
                        <AIForm action={testWorkspaceKeyAction}>
                          <input type="hidden" name="provider" value={kind} />
                          <Button type="submit" size="sm">
                            {t("admin.ai.testTheConnection")}
                          </Button>
                        </AIForm>
                        <AIForm action={removeWorkspaceKey}>
                          <input type="hidden" name="provider" value={kind} />
                          <Button type="submit" variant="ghost" size="sm">
                            {t("admin.ai.removeTheKey")}
                          </Button>
                        </AIForm>
                      </div>
                    ) : null}
                  </div>
                  <div className="border-t border-line">
                    <ProviderSettingsForm
                      kind={kind}
                      enabled={config?.enabled ?? false}
                      allowUserKeys={config?.allowUserKeys ?? false}
                      baseUrl={config?.baseUrl ?? ""}
                    />
                  </div>
                </Card>
              ),
            };
          })}
        />
      </section>

      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col">
            <h2 className="text-sm font-bold text-ink">
              {t("admin.ai.rotation")}
            </h2>
            <p className="text-xs text-ink-3">
              {t("admin.ai.reWrapsEveryStored")}
            </p>
          </div>
        </CardHeader>
        <CardBody>
          <AIForm action={rotateKeys}>
            <Button type="submit" size="sm">
              {t("admin.ai.rotateNow")}
            </Button>
          </AIForm>
        </CardBody>
      </Card>

      <section
        aria-label={t("admin.ai.models")}
        className="flex flex-col gap-3"
      >
        <GroupHeading title={t("admin.ai.models")} />
        <AddCard
          data-testid="ai-models-card"
          title={t("admin.ai.models")}
          intro={t("admin.ai.theSeededCataloguePlus")}
          addLabel={t("admin.ai.addAModel")}
          submitLabel={t("common.add")}
          action={addModel}
          list={
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-ink-3">
                  <tr>
                    <th className="py-1 pr-3 font-semibold">
                      {t("admin.ai.model")}
                    </th>
                    <th className="py-1 pr-3 font-semibold">
                      {t("admin.ai.provider")}
                    </th>
                    <th className="py-1 pr-3 font-semibold">
                      {t("admin.ai.context")}
                    </th>
                    <th className="py-1 pr-3 font-semibold">
                      {t("admin.ai.inOutPerM")}
                    </th>
                    <th className="py-1 pr-3 font-semibold">
                      {t("admin.ai.tiers")}
                    </th>
                    <th className="py-1 font-semibold">
                      {t("admin.ai.source")}
                    </th>
                  </tr>
                </thead>
                <tbody className="text-ink-2">
                  {models.map((model) => (
                    <tr
                      key={`${model.provider}:${model.modelId}`}
                      className="border-t border-line"
                    >
                      <td className="py-1.5 pr-3 text-ink">
                        {model.displayName}
                        <span className="ml-1.5 font-mono text-ink-3">
                          {model.modelId}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3">
                        {providerWord(model.provider)}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {model.contextWindow.toLocaleString("en-GB")}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {model.costInPerMillion} / {model.costOutPerMillion}
                      </td>
                      <td className="py-1.5 pr-3">
                        {model.tiers.length === 0
                          ? "—"
                          : model.tiers
                              .map((tier) => tierWord(tier))
                              .join(", ")}
                      </td>
                      <td className="py-1.5">
                        {model.source === "custom" && model.id ? (
                          <AIForm action={removeModel}>
                            <input type="hidden" name="id" value={model.id} />
                            <Button type="submit" size="sm">
                              {t("common.remove")}
                            </Button>
                          </AIForm>
                        ) : (
                          <Chip tone="neutral">{t("admin.ai.seeded")}</Chip>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
        >
          <div className="grid grid-cols-12 gap-x-6 gap-y-4">
            <SelectInput
              label={t("admin.ai.provider")}
              name="provider"
              className="col-span-12 md:col-span-4"
            >
              {AI_PROVIDER_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {providerWord(kind)}
                </option>
              ))}
            </SelectInput>
            <IdentifierInput
              id="custom-modelId"
              label={t("admin.ai.modelId")}
              name="modelId"
              required
              className="col-span-12 md:col-span-4"
            />
            <TextInput
              label={t("common.name")}
              name="displayName"
              required
              className="col-span-12 md:col-span-4"
            />
            <NumberInput
              label={t("admin.ai.contextWindow")}
              name="contextWindow"
              min={1}
              step={1}
              defaultValue={8192}
              className="col-span-12 md:col-span-4"
            />
            <NumberInput
              label={t("admin.ai.costInPerMillion")}
              name="costInPerMillion"
              min={0}
              step={0.01}
              defaultValue={0}
              unit={t("admin.ai.usdPerMillionTokens")}
              className="col-span-12 md:col-span-4"
            />
            <NumberInput
              label={t("admin.ai.costOutPerMillion")}
              name="costOutPerMillion"
              min={0}
              step={0.01}
              defaultValue={0}
              unit={t("admin.ai.usdPerMillionTokens")}
              className="col-span-12 md:col-span-4"
            />
            <fieldset className="col-span-12 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ink-2 md:col-span-6">
              <legend className="mb-1 text-sm font-medium text-ink-2">
                {t("admin.ai.capabilities")}
              </legend>
              {CAPABILITIES.map(([name, labelKey]) => (
                <label key={name} className="flex items-center gap-1.5">
                  <input type="checkbox" name={name} className="size-4" />
                  {t(labelKey)}
                </label>
              ))}
            </fieldset>
            <fieldset className="col-span-12 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ink-2 md:col-span-6">
              <legend className="mb-1 text-sm font-medium text-ink-2">
                {t("admin.ai.tiers")}
              </legend>
              {MODEL_TIERS.map((tier) => (
                <label key={tier} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    name="tiers"
                    value={tier}
                    className="size-4"
                  />
                  {tierWord(tier)}
                </label>
              ))}
            </fieldset>
          </div>
        </AddCard>
      </section>

      <section
        aria-label={t("admin.ai.tierRouting")}
        className="flex flex-col gap-3"
      >
        <GroupHeading
          title={t("admin.ai.tierRouting")}
          intro={t("admin.ai.whichModelAnswersEach")}
        />
        {routes.map((route) => (
          <Card key={route.tier} data-testid={`ai-tier-${route.tier}`}>
            <CardHeader className="justify-between">
              <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-bold text-ink">
                {tierWord(route.tier)}
                <Chip tone={route.source === "unresolved" ? "warn" : "neutral"}>
                  {route.source === "policy"
                    ? t("admin.ai.setHere")
                    : route.source === "seeded-default"
                      ? t("admin.ai.seededDefault")
                      : route.source === "deployment"
                        ? t("admin.ai.deploymentDefault")
                        : t("admin.ai.nothingAnswersThisYet")}
                </Chip>
                {route.modelId ? (
                  <code className="font-mono text-xs font-normal text-ink-3">
                    {route.modelId}
                  </code>
                ) : null}
              </span>
              {route.source === "policy" ? (
                <AIForm action={clearTier}>
                  <input type="hidden" name="tier" value={route.tier} />
                  <Button type="submit" size="sm">
                    {t("admin.ai.backToTheDefault")}
                  </Button>
                </AIForm>
              ) : null}
            </CardHeader>
            <TierRouteForm
              tier={route.tier}
              model={
                route.provider && route.modelId
                  ? tierModelValue(route.provider, route.modelId)
                  : null
              }
              current={
                route.provider && route.modelId
                  ? {
                      id: tierModelValue(route.provider, route.modelId),
                      label: route.modelId,
                      detail: providerWord(route.provider),
                    }
                  : null
              }
              options={modelChoices}
              temperature={route.temperature ?? null}
              maxTokens={route.maxTokens ?? null}
            />
          </Card>
        ))}
      </section>

      {/* The second half of S-37 (P6-G12b): what it costs, what it is allowed
          to cost, which assists are on, and what the prompts say. Its cards
          live in `governance.tsx` because the console is one screen and one
          file for it was getting long, not because it is a second screen. */}
      <section
        aria-label={t("admin.ai.spendAndLimits")}
        className="flex flex-col gap-3"
      >
        <GroupHeading title={t("admin.ai.spendAndLimits")} />
        <UsageCard
          usage={usage}
          days={USAGE_WINDOW_DAYS}
          evaluations={evaluations}
        />
        <BudgetsCard
          budgets={budgets}
          people={directory.filter(
            (member) => member.kind === "human" || member.kind === "guest",
          )}
          agents={agents.map((agent) => ({ id: agent.id, name: agent.name }))}
        />
      </section>

      <section
        aria-label={t("admin.ai.usageByAgents")}
        className="flex flex-col gap-3"
      >
        <GroupHeading title={t("admin.ai.usageByAgents")} />
        {/* Plan 0.7.0 A2: external agents' calls, totals only. */}
        <AgentCallsCard
          summary={await callAction(context, "ai.readToolCallSummary", {})}
          timeZone={String(
            (await callAction(context, "settings.readForMember", {})).settings
              .timezone ?? "UTC",
          )}
        />
        {/* Plan 0.9.0 FB1: how members rated the copilot's answers. Hidden
            while the copilot cannot answer, like every AI affordance. */}
        {
          await ratingsCard(
            context,
            session.user.id,
            workspace.workspaceId,
            ratingsParams,
          )
        }
      </section>

      <section
        aria-label={t("admin.ai.behaviour")}
        className="flex flex-col gap-3"
      >
        <GroupHeading title={t("admin.ai.behaviour")} />
        <FeaturesCard features={features} />
        <PromptsCard prompts={prompts} />
      </section>

      <PrivacyCard
        privacy={privacy}
        egress={egressStateOf(routes, providers)}
      />
    </div>
  );
}

/** The ratings list, or nothing while there is no AI to rate. */
async function ratingsCard(
  context: Parameters<typeof callAction>[0],
  userId: string,
  workspaceId: string,
  query: ReturnType<typeof ratingsQuery>,
) {
  const outcome = await resolveDrafterFor(workspaceId, "balanced", userId, {
    source: "copilot",
  });
  if (!("drafter" in outcome)) {
    return null;
  }
  const page = await callAction(context, "ai.answerRatings", {
    ...(query.filter === "all" ? {} : { rating: query.filter }),
    ...(query.cursor ? { cursor: query.cursor } : {}),
  });
  return (
    <RatingsCard
      rows={page.rows}
      more={page.more}
      filter={query.filter}
      paged={query.cursor !== undefined}
      timeZone={String(
        (await callAction(context, "settings.readForMember", {})).settings
          .timezone ?? "UTC",
      )}
    />
  );
}

/** A group heading with an optional line under it, as Providers and keys has. */
function GroupHeading({
  title,
  intro,
}: {
  readonly title: string;
  readonly intro?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-xs font-semibold tracking-wide text-ink-4 uppercase">
        {title}
      </h2>
      {intro ? <p className="max-w-prose text-xs text-ink-3">{intro}</p> : null}
    </div>
  );
}
