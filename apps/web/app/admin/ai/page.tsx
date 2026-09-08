import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { AI_PROVIDER_KINDS, MODEL_TIERS } from "@openokr/db";
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { resolveAccessLevelFor } from "../../../lib/access";
import { getPool } from "../../../lib/pool";
import { getKeyRing } from "../../../lib/secrets";
import { requireWorkspace } from "../../../lib/workspace";
import {
  addModel,
  clearTier,
  removeModel,
  removeWorkspaceKey,
  rotateKeys,
  saveProvider,
  saveTier,
  saveWorkspaceKey,
} from "./actions.ts";
import { AIForm } from "./ai-form.tsx";

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

const TIER_WORDS: Readonly<Record<string, string>> = {
  fast: "Fast",
  balanced: "Balanced",
  deep: "Deep",
  embed: "Embedding",
};

const PROVIDER_WORDS: Readonly<Record<string, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  openrouter: "OpenRouter",
  ollama: "Ollama",
  "openai-compatible": "OpenAI-compatible",
};

const STATUS_TONE: Readonly<Record<string, "ok" | "bad" | "warn">> = {
  verified: "ok",
  invalid: "bad",
  unverified: "warn",
};

export default async function AdminAIPage() {
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
      <>
        <h1 className="text-lg font-bold text-ink">AI</h1>
        <Card>
          <CardBody>
            <p className="text-sm text-ink-2">
              Configuring the AI provider is behind workspace administration,
              because a key here books spend for everybody. Ask an
              administrator.
            </p>
            <p className="mt-1 text-xs text-ink-3">
              Every check-in, score, gate and nudge works with AI off, so
              nothing you need is waiting on this.
            </p>
          </CardBody>
        </Card>
      </>
    );
  }

  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
    ring: getKeyRing(),
  };

  const [providers, models, routes] = await Promise.all([
    callAction(context, "ai.readProviderConfig", {}),
    callAction(context, "ai.readModelCatalog", {}),
    callAction(context, "ai.readTierRouting", {}),
  ]);

  const configured = providers.filter((one) => one.hasWorkspaceCredential);

  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardHeader className="justify-between">
          <div className="flex min-w-0 flex-col">
            <h1 className="text-lg font-bold text-ink">AI</h1>
            <p className="text-xs text-ink-3">
              Every rule, score, gate, corridor and nudge in this product works
              with AI off. What a provider adds is drafting, rewriting and
              language, never the decision itself.
            </p>
          </div>
          <Chip tone={configured.length > 0 ? "ok" : "neutral"}>
            {configured.length > 0
              ? `${configured.length} configured`
              : "not configured"}
          </Chip>
        </CardHeader>
      </Card>

      <section aria-label="Providers" className="flex flex-col gap-1.5">
        <h2 className="px-0.5 text-xs font-bold uppercase tracking-wide text-ink-3">
          Providers and keys
        </h2>
        {AI_PROVIDER_KINDS.map((kind) => {
          const config = providers.find((one) => one.provider === kind);
          return (
            <Card key={kind}>
              <CardHeader className="justify-between">
                <span className="flex items-center gap-2 text-sm font-medium text-ink">
                  {PROVIDER_WORDS[kind] ?? kind}
                  {config?.enabled ? (
                    <Chip tone="ok">on</Chip>
                  ) : (
                    <Chip tone="neutral">off</Chip>
                  )}
                  {config?.hasWorkspaceCredential &&
                  config.workspaceKeyStatus ? (
                    <Chip
                      tone={STATUS_TONE[config.workspaceKeyStatus] ?? "warn"}
                    >
                      {config.workspaceKeyStatus}
                    </Chip>
                  ) : null}
                </span>
                {config?.workspaceKeyHint ? (
                  <code className="font-mono text-xs text-ink-3">
                    {config.workspaceKeyHint}
                  </code>
                ) : null}
              </CardHeader>
              <CardBody className="flex flex-col gap-3">
                <AIForm action={saveProvider} className="flex flex-col gap-2">
                  <input type="hidden" name="provider" value={kind} />
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      name="enabled"
                      defaultChecked={config?.enabled ?? false}
                      className="size-4"
                    />
                    Use this provider
                  </label>
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      name="allowUserKeys"
                      defaultChecked={config?.allowUserKeys ?? false}
                      className="size-4"
                    />
                    Let members supply their own key
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-ink-3">
                    Base URL, for a self-hosted or proxied endpoint
                    <input
                      name="baseUrl"
                      defaultValue={config?.baseUrl ?? ""}
                      placeholder="leave empty for the provider's own"
                      className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                    />
                  </label>
                  <Button type="submit" variant="ghost" size="sm">
                    Save
                  </Button>
                </AIForm>

                <AIForm
                  action={saveWorkspaceKey}
                  className="flex flex-col gap-2 border-t border-line pt-3"
                >
                  <input type="hidden" name="provider" value={kind} />
                  <label className="flex flex-col gap-1 text-xs text-ink-3">
                    {config?.hasWorkspaceCredential
                      ? "Replace the key. The current one is never shown, so there is nothing to check it against."
                      : "Paste the provider key. It is encrypted on arrival and never displayed again."}
                    <input
                      name="apiKey"
                      type="password"
                      autoComplete="off"
                      required
                      className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                    />
                  </label>
                  <Button type="submit" variant="default" size="sm">
                    {config?.hasWorkspaceCredential ? "Replace" : "Store"}
                  </Button>
                </AIForm>

                {config?.hasWorkspaceCredential ? (
                  <AIForm action={removeWorkspaceKey}>
                    <input type="hidden" name="provider" value={kind} />
                    <Button type="submit" variant="ghost" size="sm">
                      Remove the key
                    </Button>
                  </AIForm>
                ) : null}
              </CardBody>
            </Card>
          );
        })}
      </section>

      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col">
            <h2 className="text-sm font-bold text-ink">Rotation</h2>
            <p className="text-xs text-ink-3">
              Re-wraps every stored key onto the current root key. Nothing loses
              access and no key is decrypted outside the server.
            </p>
          </div>
        </CardHeader>
        <CardBody>
          <AIForm action={rotateKeys}>
            <Button type="submit" variant="ghost" size="sm">
              Rotate now
            </Button>
          </AIForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col">
            <h2 className="text-sm font-bold text-ink">Models</h2>
            <p className="text-xs text-ink-3">
              The seeded catalogue, plus anything this workspace added. A custom
              entry meters cost from its own figures rather than a guess.
            </p>
          </div>
        </CardHeader>
        <CardBody className="flex flex-col gap-2.5">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-ink-3">
                <tr>
                  <th className="py-1 pr-3 font-semibold">Model</th>
                  <th className="py-1 pr-3 font-semibold">Provider</th>
                  <th className="py-1 pr-3 font-semibold">Context</th>
                  <th className="py-1 pr-3 font-semibold">In / out per M</th>
                  <th className="py-1 pr-3 font-semibold">Tiers</th>
                  <th className="py-1 font-semibold">Source</th>
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
                      {PROVIDER_WORDS[model.provider] ?? model.provider}
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
                            .map((tier) => TIER_WORDS[tier] ?? tier)
                            .join(", ")}
                    </td>
                    <td className="py-1.5">
                      {model.source === "custom" && model.id ? (
                        <AIForm action={removeModel}>
                          <input type="hidden" name="id" value={model.id} />
                          <Button type="submit" variant="ghost" size="sm">
                            Remove
                          </Button>
                        </AIForm>
                      ) : (
                        <Chip tone="neutral">seeded</Chip>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <AIForm
            action={addModel}
            className="flex flex-col gap-2 border-t border-line pt-3"
          >
            <h3 className="text-xs font-bold uppercase tracking-wide text-ink-3">
              Add a model
            </h3>
            <div className="flex flex-wrap gap-2">
              <label className="flex flex-col gap-1 text-xs text-ink-3">
                Provider
                <select
                  name="provider"
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                >
                  {AI_PROVIDER_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {PROVIDER_WORDS[kind] ?? kind}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-3">
                Model id
                <input
                  name="modelId"
                  required
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-3">
                Name
                <input
                  name="displayName"
                  required
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-3">
                Context window
                <input
                  name="contextWindow"
                  type="number"
                  min={1}
                  defaultValue={8192}
                  className="w-32 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-3">
                Cost in, per million
                <input
                  name="costInPerMillion"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={0}
                  className="w-32 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-3">
                Cost out, per million
                <input
                  name="costOutPerMillion"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={0}
                  className="w-32 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-ink-2">
              {(
                [
                  ["supportsTools", "Tools"],
                  ["supportsVision", "Vision"],
                  ["supportsJsonMode", "JSON mode"],
                  ["supportsStreaming", "Streaming"],
                ] as const
              ).map(([name, label]) => (
                <label key={name} className="flex items-center gap-1.5">
                  <input type="checkbox" name={name} className="size-3.5" />
                  {label}
                </label>
              ))}
              <span className="text-ink-3">Tiers:</span>
              {MODEL_TIERS.map((tier) => (
                <label key={tier} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    name="tiers"
                    value={tier}
                    className="size-3.5"
                  />
                  {TIER_WORDS[tier] ?? tier}
                </label>
              ))}
            </div>
            <Button type="submit" variant="default" size="sm">
              Add
            </Button>
          </AIForm>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col">
            <h2 className="text-sm font-bold text-ink">Tier routing</h2>
            <p className="text-xs text-ink-3">
              Which model answers each tier. A tier with no policy follows the
              driver's seeded default for whatever provider is on, so this is an
              override rather than a requirement.
            </p>
          </div>
        </CardHeader>
        <CardBody className="flex flex-col gap-2.5">
          {routes.map((route) => (
            <div
              key={route.tier}
              className="flex flex-col gap-1.5 border-t border-line pt-2.5 first:border-0 first:pt-0"
            >
              <span className="flex items-center gap-2 text-sm text-ink">
                {TIER_WORDS[route.tier] ?? route.tier}
                <Chip tone={route.source === "unresolved" ? "warn" : "neutral"}>
                  {route.source === "policy"
                    ? "set here"
                    : route.source === "seeded-default"
                      ? "seeded default"
                      : "nothing answers this yet"}
                </Chip>
                {route.modelId ? (
                  <code className="font-mono text-xs text-ink-3">
                    {route.modelId}
                  </code>
                ) : null}
              </span>
              <div className="flex flex-wrap items-end gap-2">
                <AIForm
                  action={saveTier}
                  className="flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="tier" value={route.tier} />
                  <label className="flex flex-col gap-1 text-xs text-ink-3">
                    Provider
                    <select
                      name="provider"
                      defaultValue={route.provider ?? AI_PROVIDER_KINDS[0]}
                      className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                    >
                      {AI_PROVIDER_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {PROVIDER_WORDS[kind] ?? kind}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-ink-3">
                    Model id
                    <input
                      name="modelId"
                      defaultValue={route.modelId ?? ""}
                      required
                      className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-ink-3">
                    Temperature
                    <input
                      name="temperature"
                      type="number"
                      min={0}
                      max={2}
                      step="0.1"
                      defaultValue={route.temperature ?? ""}
                      placeholder="driver's own"
                      className="w-28 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-ink-3">
                    Max tokens
                    <input
                      name="maxTokens"
                      type="number"
                      min={1}
                      defaultValue={route.maxTokens ?? ""}
                      placeholder="driver's own"
                      className="w-28 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                    />
                  </label>
                  <Button type="submit" variant="ghost" size="sm">
                    Route
                  </Button>
                </AIForm>
                {route.source === "policy" ? (
                  <AIForm action={clearTier}>
                    <input type="hidden" name="tier" value={route.tier} />
                    <Button type="submit" variant="ghost" size="sm">
                      Back to the default
                    </Button>
                  </AIForm>
                ) : null}
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
