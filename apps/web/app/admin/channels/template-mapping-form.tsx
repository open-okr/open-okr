"use client";

import {
  EntityPicker,
  SelectInput,
  SettingsSaveBar,
  useTranslations,
} from "@openokr/ui";
import { useActionState, useEffect, useRef, useState } from "react";
import { triggerFires } from "../../../lib/method-texts.ts";
import { saveTemplateMapping } from "./actions.ts";
import { NOTHING_YET } from "./form-state.ts";

const FORM_ID = "channel-template-mapping-form";

/**
 * Choosing which template answers which reminder (P5-T04b-b).
 *
 * **The number of source pickers is the template's, so the form has to be
 * live.** A template with two placeholders needs exactly two sources, and Meta
 * refuses a send whose count is wrong. Rendering the pickers only after a
 * template is chosen is what makes the wrong count unreachable rather than a
 * refusal after the fact.
 *
 * **Only approved templates are offered.** A pending one would be a choice that
 * looks saved and silently never sends.
 */

export interface MappableTemplate {
  readonly id: string;
  readonly name: string;
  readonly language: string;
  readonly variables: number;
  readonly bodyText: string | null;
}

export interface MappableRule {
  readonly key: string;
  readonly fires: string;
}

export interface BindingChoice {
  readonly value: string;
  readonly label: string;
}

export function TemplateMappingForm({
  rules,
  templates,
  sources,
}: {
  readonly rules: readonly MappableRule[];
  readonly templates: readonly MappableTemplate[];
  readonly sources: readonly BindingChoice[];
}) {
  const { t } = useTranslations();

  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    saveTemplateMapping,
    NOTHING_YET,
  );
  const [ruleKey, setRuleKey] = useState("");
  const [templateId, setTemplateId] = useState("");
  // Placeholders whose source was moved off the default, for the unsaved line.
  const [moved, setMoved] = useState<readonly number[]>([]);
  const chosen = templates.find((template) => template.id === templateId);
  // Named once rather than counted in the markup: the field name *is* the
  // placeholder's identity, so it is also the key React wants, and a key built
  // from a loop index is a key that moves when the template changes.
  const fields = Array.from(
    { length: chosen ? chosen.variables : 0 },
    (_, index) => ({ name: `binding${index}`, placeholder: index + 1 }),
  );

  const defaultSource = sources[0]?.value ?? "";
  const readMoved = () => {
    const element = formRef.current;
    if (!element) {
      return;
    }
    const data = new FormData(element);
    setMoved(
      fields
        .filter((field) => String(data.get(field.name) ?? "") !== defaultSource)
        .map((field) => field.placeholder),
    );
  };
  const clear = () => {
    setRuleKey("");
    setTemplateId("");
    setMoved([]);
  };
  // A saved mapping leaves the form empty for the next one.
  useEffect(() => {
    if (state !== NOTHING_YET && state.ok) {
      setRuleKey("");
      setTemplateId("");
      setMoved([]);
    }
  }, [state]);

  if (templates.length === 0) {
    return (
      <p className="px-3.5 pb-3.5 text-xs text-ink-3">
        {t("admin.channels.templateMappingForm.noApprovedTemplateYet")}
      </p>
    );
  }

  const unsaved = [
    ...(ruleKey === ""
      ? []
      : [t("admin.channels.templateMappingForm.reminder")]),
    ...(templateId === ""
      ? []
      : [t("admin.channels.templateMappingForm.template")]),
    ...moved.map((placeholder) =>
      t("admin.channels.templateMappingForm.whatFills", { placeholder }),
    ),
  ];
  const span =
    fields.length >= 3
      ? "col-span-12 md:col-span-4"
      : fields.length === 2
        ? "col-span-12 md:col-span-6"
        : "col-span-12";

  return (
    <>
      <form
        ref={formRef}
        id={FORM_ID}
        action={formAction}
        onChange={readMoved}
        onReset={clear}
        aria-busy={pending}
        className="grid grid-cols-12 gap-x-6 gap-y-4 border-t border-line p-3.5"
      >
        <SelectInput
          className="col-span-12 md:col-span-6"
          label={t("admin.channels.templateMappingForm.reminder")}
          name="ruleKey"
          value={ruleKey}
          onChange={(event) => setRuleKey(event.target.value)}
        >
          <option value="" disabled>
            {t("admin.channels.templateMappingForm.chooseAReminder")}
          </option>
          {rules.map((rule) => (
            <option key={rule.key} value={rule.key}>
              {rule.key} ({triggerFires(t, rule.key, rule.fires)})
            </option>
          ))}
        </SelectInput>

        <EntityPicker
          className="col-span-12 md:col-span-6"
          label={t("admin.channels.templateMappingForm.template")}
          name="templateId"
          required
          value={templateId === "" ? null : templateId}
          onValueChange={(next) => {
            setTemplateId(next ?? "");
            setMoved([]);
          }}
          placeholder={t("admin.channels.templateMappingForm.chooseATemplate")}
          options={templates.map((template) => ({
            id: template.id,
            label: template.name,
            detail: template.language,
          }))}
        />

        {chosen?.bodyText ? (
          <p className="col-span-12 whitespace-pre-wrap rounded-md bg-raised px-2.5 py-1.5 text-xs text-ink-3">
            {chosen.bodyText}
          </p>
        ) : null}

        {fields.map((field) => (
          <SelectInput
            className={span}
            label={t("admin.channels.templateMappingForm.whatFills", {
              placeholder: field.placeholder,
            })}
            name={field.name}
            defaultValue={defaultSource}
            key={field.name}
          >
            {sources.map((source) => (
              <option key={source.value} value={source.value}>
                {source.label}
              </option>
            ))}
          </SelectInput>
        ))}

        {chosen && fields.length === 0 ? (
          <p className="col-span-12 text-xs text-ink-3">
            {t("admin.channels.templateMappingForm.thisTemplateTakesNo")}
          </p>
        ) : null}
      </form>
      <SettingsSaveBar
        mode="footer"
        formId={FORM_ID}
        unsaved={unsaved}
        saved={state.ok && state.message ? state.message : null}
        error={state.ok ? null : state.message}
        pending={pending}
      />
    </>
  );
}
