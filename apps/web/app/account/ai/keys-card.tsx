"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  RefusedFields,
  SecretInput,
  SettingsSaveBar,
  useTranslations,
} from "@openokr/ui";
import {
  type ReactNode,
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { removePersonalKey, savePersonalKey } from "./actions.ts";
import { NOTHING_YET } from "./key-state.ts";

/** One provider that takes a personal key, with every word already translated. */
export interface KeyRow {
  readonly provider: string;
  readonly name: string;
  readonly hasKey: boolean;
  readonly statusLabel: string | null;
  readonly statusTone: "ok" | "bad" | "warn";
  readonly keyHint: string | null;
  /** "Stored on 2026-09-30", or null. */
  readonly storedOn: string | null;
  /** The field's label: paste or replace, named for the provider. */
  readonly fieldLabel: string;
  /** The bar's name for this field while it holds something unsaved. */
  readonly unsavedLabel: string;
}

/** What one press of Save answered, for the bar. */
interface SaveState {
  readonly saved: string | null;
  readonly error: string | null;
  readonly fields: Readonly<Record<string, string>>;
}

const NOTHING_SAVED: SaveState = { saved: null, error: null, fields: {} };
const FIELD_PREFIX = "apiKey-";
const FORM_ID = "personal-ai-keys";

/**
 * One Save for every key that was filled. It calls the existing
 * `savePersonalKey` once per filled provider, so each key keeps its own check,
 * its own write and its own audit row. A refusal for one provider does not
 * stop the others.
 */
async function storeFilledKeys(
  _previous: SaveState,
  form: FormData,
  pasteAKey: string,
): Promise<SaveState> {
  const saved: string[] = [];
  const errors: string[] = [];
  const fields: Record<string, string> = {};
  let filled = 0;
  for (const [name, value] of form.entries()) {
    if (!name.startsWith(FIELD_PREFIX) || String(value).trim() === "") {
      continue;
    }
    filled += 1;
    const one = new FormData();
    one.set("provider", name.slice(FIELD_PREFIX.length));
    one.set("apiKey", String(value));
    const result = await savePersonalKey(NOTHING_YET, one);
    if (result.ok) {
      saved.push(result.message);
      continue;
    }
    const refused = result.fields?.apiKey;
    if (refused) {
      fields[name] = refused;
    }
    if (result.message !== "") {
      errors.push(result.message);
    }
  }
  if (filled === 0) {
    return { saved: null, error: pasteAKey, fields: {} };
  }
  return {
    saved: saved.length > 0 ? saved.join(" ") : null,
    error:
      errors.length > 0
        ? errors.join(" ")
        : Object.keys(fields).length > 0
          ? ""
          : null,
    fields,
  };
}

/**
 * The member's own keys: one card, one sticky bar (docs/design/
 * settings-page-layout.md).
 *
 * **Empty every time, never pre-filled.** A key goes in once and the product
 * cannot read it back, so whatever a field holds is unsaved, and the bar names
 * those fields. React empties the form once a save has been answered.
 *
 * **Remove my key is instant.** It is not part of the form: it acts on the
 * stored key at once, through the same action as before, and its answer goes
 * to the bar.
 */
export function KeysCard({
  rows,
  canStore,
  title,
  description,
  neverShown,
  denied,
}: {
  readonly rows: readonly KeyRow[];
  readonly canStore: boolean;
  readonly title: string;
  readonly description: string;
  readonly neverShown: string;
  readonly denied: ReactNode;
}) {
  const { t } = useTranslations();
  const formRef = useRef<HTMLFormElement>(null);
  const pasteAKey = t("account.aiKeys.actions.pasteAKey");
  const [state, formAction, pending] = useActionState(
    (previous: SaveState, form: FormData) =>
      storeFilledKeys(previous, form, pasteAKey),
    NOTHING_SAVED,
  );
  const [unsaved, setUnsaved] = useState<readonly string[]>([]);
  const [note, setNote] = useState<{
    readonly ok: boolean;
    readonly text: string;
  } | null>(null);
  const [removing, startRemoving] = useTransition();

  const read = () => {
    const element = formRef.current;
    if (!element) {
      return;
    }
    const data = new FormData(element);
    setUnsaved(
      rows
        .filter(
          (row) =>
            String(data.get(`${FIELD_PREFIX}${row.provider}`) ?? "").trim() !==
            "",
        )
        .map((row) => row.unsavedLabel),
    );
  };

  // The save's answer replaces whatever the bar said before, and what was
  // typed is no longer there to be unsaved.
  useEffect(() => {
    if (state === NOTHING_SAVED) {
      return;
    }
    setUnsaved([]);
    if (state.saved !== null) {
      setNote({ ok: true, text: state.saved });
    } else {
      setNote(
        state.error !== null && state.error !== ""
          ? { ok: false, text: state.error }
          : null,
      );
    }
  }, [state]);

  const remove = (row: KeyRow) => {
    const form = new FormData();
    form.set("provider", row.provider);
    setNote(null);
    startRemoving(async () => {
      const result = await removePersonalKey(NOTHING_YET, form);
      setNote({ ok: result.ok, text: result.message });
    });
  };

  return (
    <>
      {canStore ? null : denied}
      <form
        ref={formRef}
        id={FORM_ID}
        action={formAction}
        autoComplete="off"
        onInput={read}
        onChange={read}
        onReset={() => setUnsaved([])}
        aria-busy={pending}
      >
        <Card>
          <CardHeader className="flex-wrap items-start">
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="text-sm font-semibold text-ink">{title}</h2>
              <p className="max-w-prose text-xs text-ink-3">{description}</p>
            </div>
          </CardHeader>
          <CardBody className="grid grid-cols-12 gap-x-6 gap-y-4">
            <p className="col-span-12 max-w-prose rounded-md bg-raised px-2.5 py-1.5 text-xs text-ink-3">
              {neverShown}
            </p>
            <RefusedFields fields={state.fields}>
              {rows.map((row, index) => (
                <div
                  key={row.provider}
                  data-testid="personal-key"
                  className={
                    index === 0
                      ? "col-span-12 grid grid-cols-12 gap-x-6 gap-y-4"
                      : "col-span-12 grid grid-cols-12 gap-x-6 gap-y-4 border-t border-line pt-4"
                  }
                >
                  <div className="col-span-12 flex min-w-0 flex-col items-start gap-1.5 md:col-span-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-ink">{row.name}</h3>
                      {row.hasKey ? (
                        <Chip tone="ok">{t("account.aiKeys.set")}</Chip>
                      ) : (
                        <Chip tone="neutral">{t("account.aiKeys.notSet")}</Chip>
                      )}
                      {row.statusLabel ? (
                        <Chip tone={row.statusTone}>{row.statusLabel}</Chip>
                      ) : null}
                      {row.keyHint ? (
                        <code className="font-mono text-xs text-ink-3">
                          {row.keyHint}
                        </code>
                      ) : null}
                    </div>
                    {row.storedOn ? (
                      <p className="text-xs text-ink-3">{row.storedOn}</p>
                    ) : null}
                    {canStore && row.hasKey ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={removing || pending}
                          onClick={() => remove(row)}
                        >
                          {removing
                            ? t("account.aiKeys.removing")
                            : t("account.aiKeys.remove")}
                        </Button>
                        <span className="rounded-full bg-raised px-2 text-xs font-semibold text-ink-3">
                          {t("common.appliesAtOnce")}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  {canStore ? (
                    <SecretInput
                      className="col-span-12 md:col-span-6"
                      label={row.fieldLabel}
                      name={`${FIELD_PREFIX}${row.provider}`}
                      maxLength={4096}
                      // Provider keys, never the member's own password: stop
                      // the browser and password managers offering logins.
                      autoComplete="new-password"
                      data-1p-ignore
                      data-lpignore="true"
                      data-bwignore
                      data-form-type="other"
                    />
                  ) : null}
                </div>
              ))}
            </RefusedFields>
          </CardBody>
        </Card>
      </form>
      {canStore ? (
        <SettingsSaveBar
          mode="sticky"
          formId={FORM_ID}
          unsaved={unsaved}
          saved={note?.ok ? note.text : null}
          error={note && !note.ok ? note.text : null}
          pending={pending}
        />
      ) : null}
    </>
  );
}
