"use client";

import {
  Button,
  CardBody,
  CopyButton,
  RefusedFields,
  SettingsSaveBar,
  useTranslations,
} from "@openokr/ui";
import {
  type ReactNode,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { NOTHING_YET, type WebhookResult } from "./form-state.ts";

type Action = (
  previous: WebhookResult | null,
  form: FormData,
) => Promise<WebhookResult>;

/** The posted fields the unsaved line names, with the catalogue key of each. */
const TRACKED = {
  name: "admin.webhooks.field.name",
  spaceId: "admin.webhooks.field.space",
  url: "admin.webhooks.field.url",
  events: "admin.webhooks.field.events",
} as const;

/** What each tracked field holds now, so a later press can be compared. */
function snapshot(form: HTMLFormElement): ReadonlyMap<string, string> {
  const data = new FormData(form);
  const held = new Map<string, string>();
  for (const name of Object.keys(TRACKED)) {
    held.set(name, data.getAll(name).map(String).sort().join("\n"));
  }
  return held;
}

/** The signing secret, shown from an action's own answer and nowhere else. */
function SecretNotice({ secret }: { readonly secret: string }) {
  const { t } = useTranslations();
  return (
    <div
      className="flex flex-col gap-1.5 rounded-md bg-brand-weak px-2.5 py-2 text-xs text-brand-text"
      data-testid="webhook-secret"
    >
      <span className="font-semibold">{t("admin.webhooks.secret.title")}</span>
      <code className="break-all font-mono text-sm font-bold">{secret}</code>
      <span>{t("admin.webhooks.secret.once")}</span>
      <CopyButton text={secret} size="sm">
        {t("admin.webhooks.secret.copy")}
      </CopyButton>
    </div>
  );
}

/**
 * A webhook form with fields (add, and a hook's Settings), outbound-webhooks.md
 * §3 and docs/design/settings-page-layout.md. The card's own footer holds
 * Discard and the submit, with a "Not saved yet" line naming what changed.
 *
 * Each kit field shows what was refused about it, and a refusal no field
 * claims, the events, is said in the footer (guided-inputs §4.2). A create
 * answers with the signing secret, which is shown here from the action's own
 * answer and nowhere else: the table holds it sealed, so there is no second
 * render that could show it again.
 */
export function WebhookForm({
  action,
  submitLabel,
  hidden,
  testId,
  children,
}: {
  readonly action: Action;
  readonly submitLabel: string;
  readonly hidden?: Readonly<Record<string, string>>;
  readonly testId?: string;
  readonly children: ReactNode;
}) {
  const { t } = useTranslations();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const saved = useRef<ReadonlyMap<string, string> | null>(null);
  const [unsaved, setUnsaved] = useState<readonly string[]>([]);
  const [state, formAction, pending] = useActionState(action, NOTHING_YET);

  const compare = () => {
    const form = formRef.current;
    if (!form || !saved.current) {
      return;
    }
    const now = snapshot(form);
    setUnsaved(
      (Object.keys(TRACKED) as (keyof typeof TRACKED)[])
        .filter((name) => now.get(name) !== saved.current?.get(name))
        .map((name) => t(TRACKED[name])),
    );
  };

  // The values the server rendered are the saved ones, taken once mounted and
  // again after an accepted save.
  // biome-ignore lint/correctness/useExhaustiveDependencies: compare reads refs and the catalogue only; it must run on a new answer, not on every render
  useEffect(() => {
    if (formRef.current && (saved.current === null || state.ok)) {
      saved.current = snapshot(formRef.current);
      compare();
    }
  }, [state]);

  return (
    <form
      ref={formRef}
      id={formId}
      action={formAction}
      onInput={compare}
      onChange={compare}
      onReset={() => setTimeout(compare, 0)}
      className="flex flex-col"
      aria-busy={pending}
      data-testid={testId}
    >
      <CardBody className="flex flex-col gap-3">
        {Object.entries(hidden ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <RefusedFields fields={state.fields}>{children}</RefusedFields>
        {state.secret ? <SecretNotice secret={state.secret} /> : null}
      </CardBody>
      <SettingsSaveBar
        mode="footer"
        formId={formId}
        unsaved={unsaved}
        saved={state.ok && state.message ? state.message : null}
        error={!state.ok && state.message ? state.message : null}
        pending={pending}
        saveLabel={submitLabel}
      />
    </form>
  );
}

/**
 * One instant write: a press that takes effect at once and is no part of a
 * card's save (Send test, Turn on or off, Take it over, Rotate secret, Remove,
 * Send again). `confirm` makes the press open an inline question first, on the
 * page and not in a browser dialog, so it is answered from the keyboard and
 * focus moves to it. A rotation answers with the new signing secret.
 */
export function WebhookAction({
  action,
  label,
  hidden,
  confirm,
  className,
}: {
  readonly action: Action;
  readonly label: string;
  readonly hidden: Readonly<Record<string, string>>;
  /** The question asked before sending, for a write that cannot be taken back. */
  readonly confirm?: string;
  readonly className?: string;
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(action, NOTHING_YET);
  const [asking, setAsking] = useState(false);
  const openRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const questionId = useId();

  // The answer closes the question; a refusal then shows beside the button.
  useEffect(() => {
    if (state !== NOTHING_YET) {
      setAsking(false);
    }
  }, [state]);

  useEffect(() => {
    if (asking) {
      confirmRef.current?.focus();
    }
  }, [asking]);

  const hiddenFields = Object.entries(hidden).map(([name, value]) => (
    <input key={name} type="hidden" name={name} value={value} />
  ));
  return (
    <form
      action={formAction}
      className={`flex min-w-0 flex-col gap-2 ${
        asking || state.secret ? "w-full" : ""
      } ${className ?? ""}`}
      aria-busy={pending}
    >
      {hiddenFields}
      {confirm ? (
        <Button
          ref={openRef}
          type="button"
          size="sm"
          aria-expanded={asking}
          disabled={pending}
          onClick={() => setAsking(true)}
        >
          {label}
        </Button>
      ) : (
        <Button type="submit" size="sm" pending={pending} disabled={pending}>
          {pending ? t("admin.webhooks.working") : label}
        </Button>
      )}
      {asking && confirm ? (
        <fieldset
          aria-labelledby={questionId}
          className="flex min-w-0 flex-col gap-2 rounded-control border border-line-2 bg-raised p-3"
        >
          <p id={questionId} className="text-sm font-medium text-ink">
            {confirm}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              ref={confirmRef}
              type="submit"
              size="sm"
              variant="primary"
              pending={pending}
            >
              {pending ? t("admin.webhooks.working") : label}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setAsking(false);
                openRef.current?.focus();
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </fieldset>
      ) : null}
      {state.secret ? <SecretNotice secret={state.secret} /> : null}
      {state.message ? (
        state.ok ? (
          <p role="status" className="text-xs text-ink-2">
            {state.message}
          </p>
        ) : (
          <p
            role="alert"
            className="rounded-md bg-bad-bg px-2.5 py-1.5 text-xs text-bad"
          >
            {state.message}
          </p>
        )
      ) : null}
    </form>
  );
}
