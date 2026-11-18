"use client";

import {
  type EntityOption,
  EntityPicker,
  NumberInput,
  RefusedFields,
  SettingsSaveBar,
  useTranslations,
} from "@openokr/ui";
import { useActionState, useEffect, useRef, useState } from "react";
import { saveTier } from "./actions.ts";
import { NOTHING_YET } from "./form-state.ts";

interface Baseline {
  readonly model: string | null;
  readonly temperature: string;
  readonly maxTokens: string;
}

/**
 * One tier's route (model, temperature, max tokens) with the card's footer
 * save bar (docs/design/settings-page-layout.md). The body and the footer
 * are siblings, so the caller puts both inside the tier's card.
 */
export function TierRouteForm({
  tier,
  model,
  current,
  options,
  temperature,
  maxTokens,
}: {
  readonly tier: string;
  /** The routed model's picker value, or null when none is routed. */
  readonly model: string | null;
  readonly current: EntityOption | null;
  readonly options: readonly EntityOption[];
  readonly temperature: number | null;
  readonly maxTokens: number | null;
}) {
  const { t } = useTranslations();
  const formId = `ai-tier-route-${tier}`;
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(saveTier, NOTHING_YET);
  const [baseline, setBaseline] = useState<Baseline>({
    model,
    temperature: temperature === null ? "" : String(temperature),
    maxTokens: maxTokens === null ? "" : String(maxTokens),
  });
  const picked = useRef<string | null>(model);
  // The picker keeps its own state, so Discard remounts the fields.
  const [generation, setGeneration] = useState(0);
  const [unsaved, setUnsaved] = useState<readonly string[]>([]);

  const read = (nextPicked: string | null) => {
    const element = formRef.current;
    if (!element) {
      return;
    }
    const data = new FormData(element);
    const changed: string[] = [];
    if (nextPicked !== baseline.model) {
      changed.push(t("admin.ai.modelId"));
    }
    if (String(data.get("temperature") ?? "").trim() !== baseline.temperature) {
      changed.push(t("admin.ai.temperature"));
    }
    if (String(data.get("maxTokens") ?? "").trim() !== baseline.maxTokens) {
      changed.push(t("admin.ai.maxTokens"));
    }
    setUnsaved(changed);
  };

  // A save the server accepted is the new baseline, so the bar goes quiet.
  useEffect(() => {
    if (state !== NOTHING_YET && state.ok) {
      const element = formRef.current;
      if (element) {
        const data = new FormData(element);
        setBaseline({
          model: picked.current,
          temperature: String(data.get("temperature") ?? "").trim(),
          maxTokens: String(data.get("maxTokens") ?? "").trim(),
        });
      }
      setUnsaved([]);
    }
  }, [state]);

  return (
    <>
      <form
        ref={formRef}
        id={formId}
        action={formAction}
        onInput={() => read(picked.current)}
        onReset={() => {
          picked.current = baseline.model;
          setGeneration((value) => value + 1);
          setUnsaved([]);
        }}
        aria-busy={pending}
        className="grid grid-cols-12 gap-x-6 gap-y-4 p-3.5"
      >
        <input type="hidden" name="tier" value={tier} />
        <RefusedFields fields={state.fields}>
          {/* One model from the catalogue above, which says its provider,
              where a provider select stood beside a name typed by hand
              (guided-inputs §4.10). A route to a model no longer listed
              still shows as what it is. */}
          <EntityPicker
            key={generation}
            label={t("admin.ai.modelId")}
            name="model"
            required
            defaultValue={baseline.model}
            onValueChange={(id) => {
              picked.current = id;
              read(id);
            }}
            options={options}
            current={current}
            className="col-span-12 md:col-span-6"
          />
          <NumberInput
            key={`t-${generation}`}
            label={t("admin.ai.temperature")}
            name="temperature"
            min={0}
            max={2}
            step={0.1}
            defaultValue={
              baseline.temperature === "" ? null : Number(baseline.temperature)
            }
            placeholder={t("admin.ai.driverSOwn")}
            className="col-span-6 md:col-span-3"
          />
          <NumberInput
            key={`m-${generation}`}
            label={t("admin.ai.maxTokens")}
            name="maxTokens"
            min={1}
            step={1}
            defaultValue={
              baseline.maxTokens === "" ? null : Number(baseline.maxTokens)
            }
            placeholder={t("admin.ai.driverSOwn")}
            className="col-span-6 md:col-span-3"
          />
        </RefusedFields>
      </form>
      <SettingsSaveBar
        mode="footer"
        formId={formId}
        unsaved={unsaved}
        saved={state.ok && state.message ? state.message : null}
        error={state.ok ? null : state.message || null}
        pending={pending}
      />
    </>
  );
}
