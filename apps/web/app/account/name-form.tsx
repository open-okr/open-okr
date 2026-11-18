"use client";

import {
  Card,
  CardBody,
  CardHeader,
  RefusedFields,
  SettingsSaveBar,
  TextInput,
  useTranslations,
} from "@openokr/ui";
import {
  type FormEvent,
  type ReactNode,
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ProfileResult } from "../people/actions.ts";

const FORM_ID = "own-name-form";

/**
 * The "Name and picture" card on Your account (screen S-51, docs/design/
 * account-self-service.md D22, D23, plan 0.8.0 Y5; docs/design/
 * settings-page-layout.md).
 *
 * Your own name is saved through `people.updateOwnProfile`, which writes this
 * workspace's member row and the account's name together; another workspace
 * keeps the name it has. The card is one of the page's footer-saved cards: the
 * picture row and the read-only title and manager come in from the page, and
 * the save bar is the card's last child, reaching the form with `form=`.
 *
 * A refusal stands under the field and keeps what was typed, submitted through
 * a transition because React resets a form after its action. After a save the
 * saved name is the new baseline, so Discard goes back to it.
 *
 * A demonstration account keeps its name, because anybody can sign in to it:
 * it sees the name as text and no save bar.
 */
export function NameForm({
  name,
  action,
  demo,
  picture,
  children,
}: {
  readonly name: string;
  readonly action: (
    previous: ProfileResult | null,
    form: FormData,
  ) => Promise<ProfileResult>;
  /** A demonstration account: the name is read only and nothing is saved. */
  readonly demo: boolean;
  /** The picture row, which is its own form and applies at once. */
  readonly picture: ReactNode;
  /** The read-only title, manager and the sentence that says who sets them. */
  readonly children: ReactNode;
}) {
  const { t } = useTranslations();
  const [state, formAction, pending] = useActionState(action, null);
  const [baseline, setBaseline] = useState(name);
  const [changed, setChanged] = useState(false);
  const typed = useRef(name);

  // The server's name is the baseline whenever it changes (a rename in
  // another tab, the page read again).
  useEffect(() => {
    setBaseline(name);
  }, [name]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    typed.current = String(data.get("name") ?? "");
    startTransition(() => formAction(data));
  };

  // A saved name is what Discard goes back to, and nothing is unsaved.
  useEffect(() => {
    if (state?.ok) {
      setBaseline(typed.current);
      setChanged(false);
    }
  }, [state]);

  return (
    <Card data-testid="name-card">
      <CardHeader>
        <div className="flex flex-col gap-0.5">
          <h2 className="text-sm font-semibold text-ink">
            {t("account.profile.nameAndPicture")}
          </h2>
          <p className="text-xs text-ink-3">
            {t("account.profile.nameAndPictureHint")}
          </p>
        </div>
      </CardHeader>
      <CardBody className="grid grid-cols-12 gap-x-6 gap-y-4 [&>ul]:col-span-12">
        <div className="col-span-12">{picture}</div>
        <div className="col-span-12 border-line border-t" />
        {demo ? (
          <div className="col-span-12 flex flex-col gap-1 text-sm">
            <p>
              <span className="text-ink-3">{t("common.name")} </span>
              <span className="text-ink" data-testid="account-name">
                {name}
              </span>
            </p>
            <p className="text-xs text-ink-3">
              {t("account.profile.demoKeepsName")}
            </p>
          </div>
        ) : (
          <form
            id={FORM_ID}
            action={formAction}
            onSubmit={submit}
            onReset={() => setChanged(false)}
            aria-busy={pending}
            data-testid="own-name"
            className="col-span-12 grid grid-cols-12 gap-x-6 gap-y-4 [&>ul]:col-span-12"
          >
            <RefusedFields fields={state?.fields}>
              <TextInput
                key={`name-${baseline}`}
                name="name"
                label={t("common.name")}
                defaultValue={baseline}
                maxLength={200}
                autoComplete="name"
                required
                className="col-span-12"
                data-testid="account-name"
                onChange={(event) =>
                  setChanged(event.currentTarget.value !== baseline)
                }
              />
            </RefusedFields>
          </form>
        )}
        {children}
      </CardBody>
      {demo ? null : (
        <SettingsSaveBar
          mode="footer"
          formId={FORM_ID}
          unsaved={changed ? [t("common.name")] : []}
          saved={state?.ok ? state.message : null}
          error={state && !state.ok && !state.fields ? state.message : null}
          pending={pending}
        />
      )}
    </Card>
  );
}
