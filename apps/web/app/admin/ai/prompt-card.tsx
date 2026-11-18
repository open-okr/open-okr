"use client";

import {
  Button,
  Card,
  CardHeader,
  Chip,
  RefusedFields,
  SettingsSaveBar,
  TextArea,
  useTranslations,
} from "@openokr/ui";
import { useActionState, useEffect, useState, useTransition } from "react";
import { restoreDefaultPrompt, savePrompt } from "./actions.ts";
import { NOTHING_YET } from "./form-state.ts";

export interface PromptCardProps {
  readonly promptKey: string;
  /** The prompt's name, already in the reader's language. */
  readonly name: string;
  readonly isDefault: boolean;
  readonly version: number;
  readonly systemPrompt: string;
  readonly history: readonly {
    readonly version: number;
    readonly createdAt: string;
  }[];
}

/**
 * One prompt in its own card with its own footer (docs/design/settings-page-layout.md).
 *
 * The submit keeps the label "Save a new version", because a press stores a
 * new version rather than overwriting. "Restore the built-in" applies at once,
 * through the action the separate form used to call, and sits at the left of
 * the footer. A save that fails its evaluation set is refused by the same
 * action, and its sentence naming the failed checks shows in the footer.
 */
export function PromptCard({
  promptKey,
  name,
  isDefault,
  version,
  systemPrompt,
  history,
}: PromptCardProps) {
  const { t } = useTranslations();
  const formId = `ai-prompt-form-${promptKey}`;
  const [state, formAction, pending] = useActionState(savePrompt, NOTHING_YET);
  const [value, setValue] = useState(systemPrompt);
  const [baseline, setBaseline] = useState(systemPrompt);
  const [restored, setRestored] = useState<{
    readonly ok: boolean;
    readonly message: string;
  } | null>(null);
  const [restoring, startRestore] = useTransition();

  // What the server stores is the new baseline, after a save or a restore.
  useEffect(() => {
    setValue(systemPrompt);
    setBaseline(systemPrompt);
  }, [systemPrompt]);

  const restore = () => {
    startRestore(async () => {
      const form = new FormData();
      form.set("promptKey", promptKey);
      const result = await restoreDefaultPrompt(NOTHING_YET, form);
      setRestored({ ok: result.ok, message: result.message });
    });
  };

  const showRestored = restored !== null && !pending;
  const saved = showRestored
    ? restored.ok && restored.message
      ? restored.message
      : null
    : state.ok && state.message
      ? state.message
      : null;
  const error = showRestored
    ? restored.ok
      ? null
      : restored.message || null
    : state.ok
      ? null
      : state.message || null;

  return (
    <Card data-testid={`ai-prompt-${promptKey}`}>
      <CardHeader>
        <div className="flex min-w-0 flex-col">
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink">
            {/*
             * A prompt is a row a workspace stores rather than a fixed list,
             * so an unknown key is normal here and falls back to itself.
             */}
            <span>{name}</span>
            {isDefault ? (
              <Chip tone="neutral">{t("admin.ai.governance.builtIn")}</Chip>
            ) : (
              <Chip tone="info">
                {t("admin.ai.governance.version", { version })}
              </Chip>
            )}
          </h2>
          <p className="text-xs text-ink-3">
            {t("admin.ai.governance.promptCardAbout")}
          </p>
        </div>
      </CardHeader>
      <form
        id={formId}
        action={formAction}
        onInput={() => setRestored(null)}
        onSubmit={() => setRestored(null)}
        onReset={(event) => {
          event.preventDefault();
          setValue(baseline);
          setRestored(null);
        }}
        aria-busy={pending}
        className="grid grid-cols-12 gap-x-6 gap-y-4 p-3.5"
      >
        <input type="hidden" name="promptKey" value={promptKey} />
        <RefusedFields fields={state.fields}>
          <TextArea
            className="col-span-12"
            label={t("admin.ai.governance.systemPromptFor", { prompt: name })}
            hideLabel
            name="systemPrompt"
            rows={4}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            inputClassName="font-mono text-xs"
          />
        </RefusedFields>
        {history.length > 0 ? (
          <details className="col-span-12 text-xs text-ink-3">
            <summary className="cursor-pointer">
              {t("admin.ai.governance.earlierVersionS", {
                length: history.length,
              })}
            </summary>
            <ul className="mt-1 flex flex-col gap-1">
              {history.map((entry) => (
                <li key={entry.version}>
                  v{entry.version}, {entry.createdAt.slice(0, 10)}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </form>
      <SettingsSaveBar
        mode="footer"
        formId={formId}
        unsaved={value === baseline ? [] : [name]}
        saved={saved}
        error={error}
        pending={pending || restoring}
        savePending={pending}
        saveLabel={t("admin.ai.governance.saveANewVersion")}
        leading={
          isDefault ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={restore}
              disabled={pending || restoring}
              pending={restoring}
            >
              {t("admin.ai.governance.restoreTheBuiltIn")}
            </Button>
          )
        }
      />
    </Card>
  );
}
