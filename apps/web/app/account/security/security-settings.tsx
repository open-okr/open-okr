"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CodeInput,
  SecretInput,
  useTranslations,
} from "@openokr/ui";
import { KeyRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { authClient } from "../../../lib/auth-client";
import { FormError } from "../../(auth)/auth-card";

/**
 * Enrolling the second factors (screen S-35's other half): a passkey, and a
 * one-time code with its backup codes.
 *
 * Backup codes are shown once, on enrolment, because they are only useful
 * before the authenticator is lost.
 *
 * **The passkeys an account holds are listed, each with a way to remove it**
 * (UAT BUG-024). Adding one used to leave nothing on the page to show it
 * had worked, and a lost device's passkey could not be taken away.
 *
 * **A card each, and the message knows which one it belongs to.** This
 * rendered as one bare `<section>` of unstyled `<h2>`s and browser-default
 * buttons until now, sitting inside a card the page drew around it. Splitting
 * it into the two cards the two headings always implied meant the single
 * shared error line had to say which enrolment it was about, so it carries
 * its own scope rather than appearing under whichever control the reader was
 * not using.
 */

/** One row of Better Auth's passkey list, the fields this screen shows. */
type Passkey = {
  readonly id: string;
  readonly name?: string | null;
  readonly createdAt: string | Date;
};

type Note = {
  readonly scope: "passkey" | "totp";
  readonly tone: "ok" | "bad";
  readonly text: string;
};

export function SecuritySettings({
  twoFactorEnabled,
  demo = false,
}: {
  twoFactorEnabled: boolean;
  /**
   * A demonstration account, whose password is published, so a one-time
   * code any visitor turned on would lock every other visitor out until the
   * nightly rebuild (account-self-service.md AS-Q8). The endpoint refuses it
   * too; this says why in place of the form.
   */
  demo?: boolean;
}) {
  const { t, locale } = useTranslations();

  const [note, setNote] = useState<Note | null>(null);
  const [passkeys, setPasskeys] = useState<readonly Passkey[] | null>(null);
  const [totpUri, setTotpUri] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  // A refused code is said on the code field itself, which then empties and
  // takes focus back, rather than in the note under the card.
  const [codeError, setCodeError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Which passkey or password button started a call, so only it spins. Cleared
  // in a `finally`, so a refused call never leaves a button stuck.
  const [acting, setActing] = useState<string | null>(null);

  const loadPasskeys = useCallback(async () => {
    const { data } = await authClient.passkey.listUserPasskeys();
    setPasskeys((data ?? []) as Passkey[]);
  }, []);

  useEffect(() => {
    void loadPasskeys();
  }, [loadPasskeys]);

  const removePasskey = async (passkey: Passkey) => {
    if (
      !window.confirm(t("account.security.securitySettings.removePasskeyAsk"))
    ) {
      return;
    }
    setNote(null);
    setActing(`remove:${passkey.id}`);
    try {
      const { error: failure } = await authClient.passkey.deletePasskey({
        id: passkey.id,
      });
      if (failure) {
        setNote({
          scope: "passkey",
          tone: "bad",
          text: t("account.security.securitySettings.passkeyNotRemoved"),
        });
        return;
      }
      await loadPasskeys();
    } finally {
      setActing(null);
    }
  };

  const added = (when: string | Date) =>
    new Date(when).toLocaleDateString(locale === "pseudo" ? "en" : locale, {
      dateStyle: "medium",
    });

  const addPasskey = async () => {
    setNote(null);
    setActing("add-passkey");
    try {
      const result = await authClient.passkey.addPasskey();
      if (result?.error) {
        setNote({
          scope: "passkey",
          tone: "bad",
          text: t("account.security.securitySettings.passkeyNotAdded"),
        });
        return;
      }
      setNote({
        scope: "passkey",
        tone: "ok",
        text: t("account.security.securitySettings.passkeyNowAdded"),
      });
      await loadPasskeys();
    } finally {
      setActing(null);
    }
  };

  const startTwoFactor = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNote(null);
    setActing("enable-totp");
    let started: Awaited<ReturnType<typeof authClient.twoFactor.enable>>;
    try {
      started = await authClient.twoFactor.enable({ password });
    } finally {
      setActing(null);
    }
    const { data, error: failure } = started;
    if (failure || !data) {
      setNote({
        scope: "totp",
        tone: "bad",
        text: t("account.security.securitySettings.passwordNotRight"),
      });
      return;
    }
    // Better Auth 1.7 returns one of two shapes here. A second factor sent as
    // a one-time code carries nothing to show, and only the authenticator app
    // ("totp") returns a secret to scan and the backup codes. This screen
    // offers the authenticator app, so the other shape means the instance is
    // configured for something this form cannot complete, and saying so beats
    // rendering an empty QR code.
    if (data.method !== "totp") {
      setNote({
        scope: "totp",
        tone: "bad",
        text: t("account.security.securitySettings.noAuthenticatorApp"),
      });
      return;
    }
    setTotpUri(data.totpURI);
    setBackupCodes(data.backupCodes);
    setPassword("");
  };

  // Called by the code field once its sixth digit is in, and by Turn on.
  const confirmTwoFactor = async (entered: string) => {
    setNote(null);
    setCodeError(null);
    setConfirming(true);
    const { error: failure } = await authClient.twoFactor.verifyTotp({
      code: entered,
    });
    setConfirming(false);
    if (failure) {
      setCode("");
      setCodeError(t("account.security.securitySettings.thatCodeWasNotRight"));
      return;
    }
    setNote({
      scope: "totp",
      tone: "ok",
      text: t("account.security.securitySettings.oneTimeCodesOnKeepBackup"),
    });
    setTotpUri("");
    setCode("");
  };

  /** The one message, under the control that produced it. */
  const noteFor = (scope: Note["scope"]) => {
    if (note === null || note.scope !== scope) {
      return null;
    }
    return note.tone === "bad" ? (
      <FormError>{note.text}</FormError>
    ) : (
      <p
        role="status"
        className="rounded-md bg-ok-bg px-2.5 py-1.5 text-xs font-medium text-ok"
      >
        {note.text}
      </p>
    );
  };

  const footerNote = (scope: Note["scope"]) => {
    const node = noteFor(scope);
    return node === null ? null : (
      <div className="border-line border-t px-3.5 py-2.5">{node}</div>
    );
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-sm font-semibold text-ink">
              {t("account.security.securitySettings.passkeys")}
            </h2>
            <p className="text-xs text-ink-3">
              {t("account.security.securitySettings.aPasskeySignsYou")}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={acting !== null}
            pending={acting === "add-passkey"}
            onClick={addPasskey}
          >
            {t("account.security.securitySettings.addAPasskey")}
          </Button>
        </CardHeader>
        {passkeys === null ? null : (
          <CardBody>
            {passkeys.length === 0 ? (
              <p className="text-sm text-ink-3">
                {t("account.security.securitySettings.noPasskeysYet")}
              </p>
            ) : (
              <ul
                className="flex flex-col rounded-lg border border-line"
                aria-label={t("account.security.securitySettings.passkeys")}
              >
                {passkeys.map((passkey, index) => (
                  <li
                    key={passkey.id}
                    className={`flex items-center gap-3 px-3 py-2.5 ${index === 0 ? "" : "border-line border-t"}`}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-3">
                      <KeyRound className="size-4" aria-hidden="true" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium text-ink">
                        {passkey.name ||
                          t("account.security.securitySettings.unnamedPasskey")}
                      </span>
                      <span className="text-xs text-ink-3">
                        {t("account.security.securitySettings.passkeyAdded", {
                          date: added(passkey.createdAt),
                        })}
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={acting !== null}
                      pending={acting === `remove:${passkey.id}`}
                      onClick={() => removePasskey(passkey)}
                    >
                      {t("account.security.securitySettings.removePasskey")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        )}
        {footerNote("passkey")}
      </Card>

      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-sm font-semibold text-ink">
              {t("account.security.securitySettings.oneTimeCodes")}
            </h2>
            <p className="text-xs text-ink-3">
              {t("account.security.securitySettings.oneTimeCodesHint")}
            </p>
          </div>
          <span
            className={`rounded-full px-2 font-semibold text-xs ${
              twoFactorEnabled ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"
            }`}
          >
            {twoFactorEnabled
              ? t("account.security.securitySettings.statusOn")
              : t("account.security.securitySettings.statusOff")}
          </span>
        </CardHeader>
        <CardBody className="grid grid-cols-12 gap-x-6 gap-y-4">
          {twoFactorEnabled ? (
            <p className="col-span-12 max-w-prose text-sm text-ink-3">
              {t("account.security.securitySettings.oneTimeCodesAre")}
            </p>
          ) : demo ? (
            <p className="col-span-12 max-w-prose text-sm text-ink-3">
              {t("account.security.securitySettings.demoKeepsSignIn")}
            </p>
          ) : totpUri ? (
            <>
              <div className="col-span-12 flex flex-col gap-2">
                <p className="max-w-prose text-sm text-ink-3">
                  {t("account.security.securitySettings.addThisToYour")}
                </p>
                <code className="w-full break-all rounded-md bg-raised px-2.5 py-2 font-mono text-xs text-ink-2">
                  {totpUri}
                </code>
              </div>

              {backupCodes.length > 0 ? (
                <div className="col-span-12 flex flex-col gap-1.5">
                  <h3 className="text-xs font-bold text-ink">
                    {t("account.security.securitySettings.backupCodes")}
                  </h3>
                  <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                    {backupCodes.map((backupCode) => (
                      <li key={backupCode}>
                        <code className="block rounded bg-raised px-1.5 py-0.5 text-center font-mono text-xs text-ink">
                          {backupCode}
                        </code>
                      </li>
                    ))}
                  </ul>
                  <p className="max-w-prose text-xs text-ink-3">
                    {t("account.security.securitySettings.saveTheseNowEach")}
                  </p>
                </div>
              ) : null}

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  confirmTwoFactor(code);
                }}
                className="col-span-12 grid grid-cols-12 gap-x-6 gap-y-4"
              >
                <div className="col-span-12 md:col-span-9">
                  <CodeInput
                    id="totp-code"
                    label={t(
                      "account.security.securitySettings.codeFromYourApp",
                    )}
                    groups={[6]}
                    characters="digits"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={setCode}
                    onComplete={confirmTwoFactor}
                    busy={confirming}
                    error={codeError}
                  />
                </div>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  className="col-span-12 w-full self-end md:col-span-3"
                  disabled={code.length < 6}
                  pending={confirming}
                >
                  {t("account.security.securitySettings.turnOn")}
                </Button>
              </form>
            </>
          ) : (
            <form
              onSubmit={startTwoFactor}
              className="col-span-12 grid grid-cols-12 gap-x-6 gap-y-4"
            >
              <SecretInput
                label={t(
                  "account.security.securitySettings.confirmYourPassword",
                )}
                id="confirm-password"
                autoComplete="current-password"
                required
                className="col-span-12 md:col-span-9"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Button
                type="submit"
                variant="primary"
                size="sm"
                className="col-span-12 w-full self-end md:col-span-3"
                disabled={acting !== null}
                pending={acting === "enable-totp"}
              >
                {t("account.security.securitySettings.setUpOneTime")}
              </Button>
            </form>
          )}
        </CardBody>
        {footerNote("totp")}
      </Card>
    </>
  );
}
