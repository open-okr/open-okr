"use client";

import { Button } from "@openokr/ui";
import { useState } from "react";
import { saveTemplateMapping } from "./actions.ts";
import { ChannelForm } from "./channel-form.tsx";

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

const FIELD =
  "rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink";

export function TemplateMappingForm({
  rules,
  templates,
  sources,
}: {
  readonly rules: readonly MappableRule[];
  readonly templates: readonly MappableTemplate[];
  readonly sources: readonly BindingChoice[];
}) {
  const [templateId, setTemplateId] = useState("");
  const chosen = templates.find((template) => template.id === templateId);
  // Named once rather than counted in the markup: the field name *is* the
  // placeholder's identity, so it is also the key React wants, and a key built
  // from a loop index is a key that moves when the template changes.
  const fields = Array.from(
    { length: chosen ? chosen.variables : 0 },
    (_, index) => ({ name: `binding${index}`, placeholder: index + 1 }),
  );

  if (templates.length === 0) {
    return (
      <p className="text-xs text-ink-3">
        No approved template yet. Meta has to approve the words before a
        reminder can use them.
      </p>
    );
  }

  return (
    <ChannelForm
      action={saveTemplateMapping}
      className="flex flex-col gap-2 rounded-lg border border-line p-3"
    >
      <label className="flex flex-col gap-1 text-xs text-ink-2">
        Reminder
        <select name="ruleKey" className={FIELD} defaultValue="">
          <option value="" disabled>
            Choose a reminder
          </option>
          {rules.map((rule) => (
            <option key={rule.key} value={rule.key}>
              {rule.key} ({rule.fires})
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-ink-2">
        Template
        <select
          name="templateId"
          className={FIELD}
          value={templateId}
          onChange={(event) => setTemplateId(event.target.value)}
        >
          <option value="" disabled>
            Choose a template
          </option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} ({template.language})
            </option>
          ))}
        </select>
      </label>

      {chosen?.bodyText ? (
        <p className="whitespace-pre-wrap rounded-md bg-surface-2 px-2.5 py-1.5 text-xs text-ink-3">
          {chosen.bodyText}
        </p>
      ) : null}

      {fields.map((field) => (
        <label
          key={field.name}
          className="flex flex-col gap-1 text-xs text-ink-2"
        >
          {`What fills {{${field.placeholder}}}`}
          <select
            name={field.name}
            className={FIELD}
            defaultValue={sources[0]?.value ?? ""}
          >
            {sources.map((source) => (
              <option key={source.value} value={source.value}>
                {source.label}
              </option>
            ))}
          </select>
        </label>
      ))}

      {chosen && fields.length === 0 ? (
        <p className="text-xs text-ink-3">
          This template takes no variables, so it says the same thing every
          time.
        </p>
      ) : null}

      <Button type="submit" variant="primary" size="sm" className="w-fit">
        Save
      </Button>
    </ChannelForm>
  );
}
