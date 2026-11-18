"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EntityPicker,
  SelectInput,
  SettingsSaveBar,
  useTranslations,
} from "@openokr/ui";
import { useEffect, useState, useTransition } from "react";
import { searchGoals } from "../../../lib/entity-search.ts";
import { bindAgentScopeAction, setAgentAutonomyAction } from "./actions";

/**
 * An agent's write policy and its scope (S-38, P6-G13b, GAP-AUDIT G-05).
 *
 * **`agents.create` took an autonomy and nothing could change it.** The column
 * has held the three policies since P4-T05a, and moving an agent between them
 * needed a database session, so the propose-and-approve default was in
 * practice permanent and the sandbox a one-way door. `agents.setAutonomy` is
 * new with this.
 *
 * **What each policy does is written beside it**, rather than three words to
 * guess between. "Scoped direct" is the one that writes without asking, and a
 * screen that offers it as a bare label is a screen that gets it chosen by
 * accident.
 *
 * **The workspace is not in the picker, and the action refuses it too.**
 * CLAUDE.md's rule is that an agent gets bindings on named spaces, goals and
 * KPI trees only and that there is no service account with ambient authority.
 * `agents.bindScope` said "never workspace-wide" in its own summary from
 * P4-T05a and enforced nothing; both halves are here now, because an interface
 * that merely omits an option is not an authorisation. P6-G13b wrote them and
 * had to withdraw them, because the access floor left an agent bound to a
 * space unable to write; P6-G13c fixed the floor and they are back.
 *
 * **The policy is chosen, then saved.** The three policies are radio tiles
 * with a footer: "Save changes" sends the choice through the same action the
 * buttons called, "Discard" puts the saved one back, and the bar says "Not
 * saved yet" while they differ. Widening to "Scoped direct" still asks first,
 * at the moment Save changes is pressed. Nothing here raises an agent's
 * autonomy on its own; only when the choice is sent has changed.
 *
 * **Binding a scope applies at once.** "Bind a scope" opens a panel in the
 * Scope card whose Bind button calls the action; there is no Discard, and
 * Cancel only closes the panel.
 *
 * **The policy list and the access levels arrive as props.** Importing
 * `AGENT_AUTONOMIES` from `@openokr/db` and `ACCESS_LEVELS` from
 * `@openokr/core` put the database layer into a client bundle and the build
 * failed on `dns` and `fs`. Every other client component in this app imports
 * types from those packages and never values, which is the rule; the page is
 * a server component and passes what it already holds.
 */

/**
 * §6's three policies, in the order they widen. A function of `t` so the
 * wording comes from the catalogue in the reader's language.
 */
function policies(
  t: (key: string) => string,
): Record<string, { label: string; means: string }> {
  return {
    sandbox: {
      label: t("admin.agents.agentPolicy.sandbox"),
      means: t("admin.agents.agentPolicy.sandboxMeans"),
    },
    propose: {
      label: t("admin.agents.agentPolicy.propose"),
      means: t("admin.agents.agentPolicy.proposeMeans"),
    },
    scoped_direct: {
      label: t("admin.agents.agentPolicy.scopedDirect"),
      means: t("admin.agents.agentPolicy.scopedDirectMeans"),
    },
  };
}

/** What an agent can be bound to. The workspace is deliberately absent. */
const BINDABLE = [
  { type: "space", labelKey: "initiatives.space" },
  { type: "goal", labelKey: "admin.agents.agentPolicy.goal" },
  { type: "kpi_tree", labelKey: "admin.agents.agentPolicy.kpiTree" },
] as const;

export function WritePolicyCard({
  agentId,
  autonomy,
  name,
  autonomies,
}: {
  readonly agentId: string;
  readonly autonomy: string;
  readonly name: string;
  /** Every policy the column can hold, from the table. */
  readonly autonomies: readonly string[];
}) {
  const { t } = useTranslations();
  const POLICY = policies(t);
  const formId = `agent-policy-form-${agentId}`;
  const [chosen, setChosen] = useState(autonomy);
  const [baseline, setBaseline] = useState(autonomy);
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // What the server stores is the new baseline, after a save here or a change
  // made elsewhere.
  useEffect(() => {
    setChosen(autonomy);
    setBaseline(autonomy);
  }, [autonomy]);

  const label = t("admin.agents.agentPolicy.writePolicy");

  return (
    <Card data-testid={`agent-policy-${agentId}`}>
      <CardHeader>
        <div className="flex min-w-0 flex-col">
          <h3 className="text-sm font-bold text-ink">{label}</h3>
          <p className="text-xs text-ink-3">
            {t("admin.agents.agentPolicy.writePolicyAbout", { name })}
          </p>
        </div>
      </CardHeader>
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          if (chosen === baseline) {
            return;
          }
          if (
            chosen === "scoped_direct" &&
            !window.confirm(
              t("admin.agents.agentPolicy.confirmScopedDirect", { name }),
            )
          ) {
            return;
          }
          setProblem(null);
          setSaved(null);
          const sent = chosen;
          start(async () => {
            const result = await setAgentAutonomyAction(
              agentId,
              sent as "sandbox" | "propose" | "scoped_direct",
            );
            setProblem(result.error);
            if (result.error === null) {
              setBaseline(sent);
              setSaved(t("admin.agents.agentPolicy.saved"));
            }
          });
        }}
        onReset={(event) => {
          event.preventDefault();
          setChosen(baseline);
          setProblem(null);
          setSaved(null);
        }}
        aria-busy={pending}
        className="p-3.5"
      >
        <fieldset
          disabled={pending}
          className="grid grid-cols-12 gap-x-6 gap-y-3"
        >
          <legend className="sr-only">{label}</legend>
          {autonomies.map((option) => (
            <label
              key={option}
              className="col-span-12 flex items-start gap-2.5 rounded-lg border border-line p-3 text-sm has-[:checked]:border-brand-line has-[:checked]:bg-brand-weak lg:col-span-4"
            >
              <input
                type="radio"
                name="autonomy"
                value={option}
                checked={chosen === option}
                data-testid={`autonomy-${option}`}
                onChange={() => {
                  setChosen(option);
                  setSaved(null);
                }}
                className="mt-0.5 size-4"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium text-ink">
                  {POLICY[option]?.label ?? option}
                </span>
                <span className="text-xs text-ink-3">
                  {POLICY[option]?.means ?? option}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      </form>
      <SettingsSaveBar
        mode="footer"
        formId={formId}
        unsaved={chosen === baseline ? [] : [label]}
        saved={saved}
        error={problem}
        pending={pending}
      />
    </Card>
  );
}

export function ScopeCard({
  agentId,
  levels,
  spaces,
  trees,
}: {
  readonly agentId: string;
  /** The four access levels, from the canon's own map. */
  readonly levels: readonly {
    readonly value: number;
    readonly label: string;
  }[];
  /** The spaces and KPI trees an agent can be bound to, by name. */
  readonly spaces: readonly { readonly id: string; readonly name: string }[];
  readonly trees: readonly { readonly id: string; readonly name: string }[];
}) {
  const { t } = useTranslations();
  // What the binding names decides what the picker offers (guided-inputs
  // §4.10), where an id was pasted from the thing's own page. Goals can be
  // tens of thousands, so they are searched rather than listed.
  const [kind, setKind] = useState<(typeof BINDABLE)[number]["type"]>("space");
  const choices = kind === "space" ? spaces : kind === "kpi_tree" ? trees : [];

  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const formId = `agent-bind-form-${agentId}`;

  return (
    <Card data-testid={`agent-scope-${agentId}`}>
      <CardHeader className="justify-between">
        <div className="flex min-w-0 flex-col">
          <h3 className="text-sm font-bold text-ink">
            {t("admin.agents.agentPolicy.scope")}
          </h3>
          <p className="text-xs text-ink-3">
            {t("admin.agents.agentPolicy.anAgentIsBound")}
          </p>
        </div>
        {open ? null : (
          <Button
            type="button"
            size="sm"
            variant="default"
            onClick={() => setOpen(true)}
          >
            {t("admin.agents.agentPolicy.bindAScope")}
          </Button>
        )}
      </CardHeader>
      {open ? (
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setProblem(null);
            start(async () => {
              const result = await bindAgentScopeAction({
                agentId,
                resourceType: String(form.get("resourceType") ?? ""),
                resourceId: String(form.get("resourceId") ?? "").trim(),
                level: Number(form.get("level")),
              });
              setProblem(result.error);
              if (!result.error) {
                setOpen(false);
              }
            });
          }}
        >
          <div className="grid grid-cols-12 gap-x-6 gap-y-4 p-3.5">
            <SelectInput
              className="col-span-12 lg:col-span-4"
              label={t("admin.agents.agentPolicy.what")}
              name="resourceType"
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as (typeof BINDABLE)[number]["type"])
              }
            >
              {BINDABLE.map((one) => (
                <option key={one.type} value={one.type}>
                  {t(one.labelKey)}
                </option>
              ))}
            </SelectInput>
            <EntityPicker
              key={kind}
              label={t("admin.agents.agentPolicy.which")}
              name="resourceId"
              required
              options={choices.map((one) => ({ id: one.id, label: one.name }))}
              {...(kind === "goal" ? { search: searchGoals } : {})}
              className="col-span-12 lg:col-span-4"
            />
            <SelectInput
              className="col-span-12 lg:col-span-4"
              label={t("common.level")}
              name="level"
              defaultValue={String(levels[2]?.value ?? 70)}
            >
              {levels.map((one) => (
                <option key={one.value} value={one.value}>
                  {one.label}
                </option>
              ))}
            </SelectInput>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3.5 py-2.5">
            <div className="min-w-0">
              {problem ? (
                <p
                  role="alert"
                  data-testid="agent-policy-error"
                  className="text-xs text-bad"
                >
                  {problem}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setProblem(null);
                  setOpen(false);
                }}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                variant="primary"
                disabled={pending}
                pending={pending}
              >
                {pending
                  ? t("admin.agents.agentPolicy.binding")
                  : t("admin.agents.agentPolicy.bind")}
              </Button>
            </div>
          </div>
        </form>
      ) : problem ? (
        <CardBody>
          <p
            role="alert"
            data-testid="agent-policy-error"
            className="text-xs text-bad"
          >
            {problem}
          </p>
        </CardBody>
      ) : null}
    </Card>
  );
}
