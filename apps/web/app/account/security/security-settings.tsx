"use client";

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  useTranslations,
} from "@openokr/ui";
import { useState } from "react";
import { authClient } from "../../../lib/auth-client";
import { FormError } from "../../(auth)/auth-card";

/**
 * Enrolling the second factors (screen S-35's other half): a passkey, and a
 * one-time code with its backup codes.
 *
 * Backup codes are shown once, on enrolment, because they are only useful
 * before the authenticator is lost.
 *
 * **A card each, and the message knows which one it belongs to.** This
 * rendered as one bare `<section>` of unstyled `<h2>`s and browser-default
 * buttons until now, sitting inside a card the page drew around it. Splitting
 * it into the two cards the two headings always implied meant the single
 * shared error line had to say which enrolment it was about, so it carries
 * its own scope rather than appearing under whichever control the reader was
 * not using.
 */

const INPUT_CLASS =
  "rounded-control border border-line-2 bg-surface px-2.5 py-1.5 text-sm font-normal text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand-line";

const LABEL_CLASS =
  "flex w-full max-w-xs flex-col gap-1 text-xs font-semibold text-ink-2";

type Note = {
  readonly scope: "passkey" | "totp";
  readonly tone: "ok" | "bad";
  readonly text: string;
};

export function SecuritySettings({
  twoFactorEnabled,
}: {
  twoFactorEnabled: boolean;
}) {
  const { t } = useTranslations();

  const [note, setNote] = useState<Note | null>(null);
  const [totpUri, setTotpUri] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const addPasskey = async () => {
    setNote(null);
    const result = await authClient.passkey.addPasskey();
    if (result?.error) {
      setNote({
        scope: "passkey",
        tone: "bad",
        text: "That did not work. Your device may not support passkeys.",
      });
      return;
    }
    setNote({
      scope: "passkey",
      tone: "ok",
      text: "Passkey added. You can now sign in with it.",
    });
  };

  const startTwoFactor = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNote(null);
    const { data, error: failure } = await authClient.twoFactor.enable({
      password,
    });
    if (failure || !data) {
      setNote({
        scope: "totp",
        tone: "bad",
        text: "That password was not right.",
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
        text: "This instance is not set up for an authenticator app.",
      });
      return;
    }
    setTotpUri(data.totpURI);
    setBackupCodes(data.backupCodes);
    setPassword("");
  };

  const confirmTwoFactor = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNote(null);
    const { error: failure } = await authClient.twoFactor.verifyTotp({ code });
    if (failure) {
      setNote({
        scope: "totp",
        tone: "bad",
        text: "That code was not right. Codes change every 30 seconds.",
      });
      return;
    }
    setNote({
      scope: "totp",
      tone: "ok",
      text: "One-time codes are on. Keep your backup codes somewhere safe.",
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

  return (
    <>
      <Card>
        <CardHeader>
          <h2 className="text-sm font-bold text-ink">
            {t("account.security.securitySettings.passkeys")}
          </h2>
        </CardHeader>
        <CardBody className="flex flex-col items-start gap-3">
          <p className="max-w-prose text-sm text-ink-3">
            {t("account.security.securitySettings.aPasskeySignsYou")}
          </p>
          <Button type="button" size="sm" onClick={addPasskey}>
            {t("account.security.securitySettings.addAPasskey")}
          </Button>
          {noteFor("passkey")}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-bold text-ink">
            {t("account.security.securitySettings.oneTimeCodes")}
          </h2>
        </CardHeader>
        <CardBody className="flex flex-col items-start gap-3">
          {twoFactorEnabled ? (
            <p className="max-w-prose text-sm text-ink-3">
              {t("account.security.securitySettings.oneTimeCodesAre")}
            </p>
          ) : totpUri ? (
            <>
              <p className="max-w-prose text-sm text-ink-3">
                {t("account.security.securitySettings.addThisToYour")}
              </p>
              <code className="w-full break-all rounded-md bg-raised px-2.5 py-2 font-mono text-xs text-ink-2">
                {totpUri}
              </code>

              {backupCodes.length > 0 ? (
                <div className="flex w-full flex-col gap-1.5 rounded-lg border border-line p-3">
                  <h3 className="text-xs font-bold text-ink">
                    {t("account.security.securitySettings.backupCodes")}
                  </h3>
                  <p className="max-w-prose text-xs text-ink-3">
                    {t("account.security.securitySettings.saveTheseNowEach")}
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {backupCodes.map((backupCode) => (
                      <li key={backupCode}>
                        <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-xs text-ink">
                          {backupCode}
                        </code>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <form
                onSubmit={confirmTwoFactor}
                className="flex flex-col items-start gap-3"
              >
                <label htmlFor="totp-code" className={LABEL_CLASS}>
                  {t("account.security.securitySettings.codeFromYourApp")}
                  <input
                    id="totp-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    className={INPUT_CLASS}
                  />
                </label>
                <Button type="submit" variant="primary" size="sm">
                  {t("account.security.securitySettings.turnOn")}
                </Button>
              </form>
            </>
          ) : (
            <form
              onSubmit={startTwoFactor}
              className="flex flex-col items-start gap-3"
            >
              <label htmlFor="confirm-password" className={LABEL_CLASS}>
                {t("account.security.securitySettings.confirmYourPassword")}
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={INPUT_CLASS}
                />
              </label>
              <Button type="submit" variant="primary" size="sm">
                {t("account.security.securitySettings.setUpOneTime")}
              </Button>
            </form>
          )}
          {noteFor("totp")}
        </CardBody>
      </Card>
    </>
  );
}
