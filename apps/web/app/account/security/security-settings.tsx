"use client";

import { useState } from "react";
import { authClient } from "../../../lib/auth-client";
import { FormError } from "../../(auth)/auth-card";

/**
 * Enrolling the second factors (screen S-35's other half): a passkey, and a
 * one-time code with its backup codes.
 *
 * Backup codes are shown once, on enrolment, because they are only useful
 * before the authenticator is lost.
 */
export function SecuritySettings({
  twoFactorEnabled,
}: {
  twoFactorEnabled: boolean;
}) {
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const addPasskey = async () => {
    setError("");
    setStatus("");
    const result = await authClient.passkey.addPasskey();
    if (result?.error) {
      setError("That did not work. Your device may not support passkeys.");
      return;
    }
    setStatus("Passkey added. You can now sign in with it.");
  };

  const startTwoFactor = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const { data, error: failure } = await authClient.twoFactor.enable({
      password,
    });
    if (failure || !data) {
      setError("That password was not right.");
      return;
    }
    setTotpUri(data.totpURI);
    setBackupCodes(data.backupCodes);
    setPassword("");
  };

  const confirmTwoFactor = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const { error: failure } = await authClient.twoFactor.verifyTotp({ code });
    if (failure) {
      setError("That code was not right. Codes change every 30 seconds.");
      return;
    }
    setStatus("One-time codes are on. Keep your backup codes somewhere safe.");
    setTotpUri("");
    setCode("");
  };

  return (
    <section style={{ fontFamily: "system-ui, sans-serif" }}>
      <h2>Passkeys</h2>
      <p>
        A passkey signs you in with your device instead of a password, and
        cannot be phished.
      </p>
      <button type="button" onClick={addPasskey}>
        Add a passkey
      </button>

      <h2>One-time codes</h2>
      {twoFactorEnabled ? (
        <p>One-time codes are on for this account.</p>
      ) : totpUri ? (
        <>
          <p>
            Add this to your authenticator app, then enter the code it shows to
            switch it on.
          </p>
          <code style={{ wordBreak: "break-all" }}>{totpUri}</code>

          {backupCodes.length > 0 ? (
            <>
              <h3>Backup codes</h3>
              <p>
                Save these now. Each works once, and this is the only time they
                are shown.
              </p>
              <ul>
                {backupCodes.map((backupCode) => (
                  <li key={backupCode}>
                    <code>{backupCode}</code>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <form onSubmit={confirmTwoFactor}>
            <label htmlFor="totp-code">Code from your app</label>
            <input
              id="totp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <button type="submit">Turn on</button>
          </form>
        </>
      ) : (
        <form onSubmit={startTwoFactor}>
          <label htmlFor="confirm-password">Confirm your password</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button type="submit">Set up one-time codes</button>
        </form>
      )}

      <FormError>{error}</FormError>
      {status ? <p role="status">{status}</p> : null}
    </section>
  );
}
