"use client";

import type { SSOConnectionDetails } from "@openokr/core";
import { Button, useToast, useTranslations } from "@openokr/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  removeSSOConnectionAction,
  setSSOConnectionEnabledAction,
} from "./actions";
import { SSOForm } from "./sso-form";
import type { SSOWriteResult } from "./sso-result.ts";

type Mode = "idle" | "editing" | "confirmOff" | "confirmRemove";

/**
 * Edit, turn off or on, and remove, for one single sign-on connection.
 *
 * **Removing asks first, and so does turning off an enforced connection.**
 * Both hand the connection's domains back to passwords the moment they land,
 * because enforcement is read only from connections that are on and not
 * removed, and the question says so in those words. Turning off a connection
 * that enforces nothing is one press, because turning it on again is one
 * press too. A removed connection cannot be brought back from this screen,
 * which is why removing always asks.
 *
 * **The question is on the page rather than in a browser dialog**, so it can
 * say which domains, it is reached and answered from the keyboard like the
 * rest of the row, and focus moves to it when it opens.
 */
export function ConnectionControls({
  connection,
}: {
  readonly connection: SSOConnectionDetails;
}) {
  const { t } = useTranslations();
  const { show } = useToast();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const switchRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);

  // Enforcement only bites while the connection is on and names a domain,
  // which is the rule `listEnforcingConnections` applies at sign-in.
  const enforcedDomains =
    connection.enabled && connection.enforce
      ? connection.emailDomains.trim()
      : "";

  useEffect(() => {
    if (mode === "confirmOff" || mode === "confirmRemove") {
      confirmRef.current?.focus();
    }
  }, [mode]);

  /** Closes the question or the form, and gives focus back to what opened it. */
  const close = () => {
    const opener =
      mode === "confirmRemove"
        ? removeRef
        : mode === "confirmOff"
          ? switchRef
          : editRef;
    setMode("idle");
    opener.current?.focus();
  };

  const run = (write: () => Promise<SSOWriteResult>, done: () => void) =>
    start(async () => {
      setProblem(null);
      setNotice(null);
      const result = await write();
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      setMode("idle");
      done();
      router.refresh();
    });

  const switchTo = (enabled: boolean) =>
    run(
      () => setSSOConnectionEnabledAction(connection.id, enabled),
      () =>
        setNotice(
          enabled
            ? t("admin.sso.connectionControls.turnedOn")
            : t("admin.sso.connectionControls.turnedOff"),
        ),
    );

  const remove = () =>
    run(
      () => removeSSOConnectionAction(connection.id),
      // The row is gone once the list comes back, so the confirmation is a
      // toast, which outlives it.
      () =>
        show({
          tone: "ok",
          message: t("admin.sso.connectionControls.removed", {
            name: connection.displayName,
          }),
          source: `sso-${connection.id}`,
        }),
    );

  const question =
    mode === "confirmRemove"
      ? t("admin.sso.connectionControls.removeQuestion", {
          name: connection.displayName,
        })
      : t("admin.sso.connectionControls.turnOffQuestion", {
          name: connection.displayName,
        });
  const questionId = `sso-${connection.id}-question`;

  return (
    <div className="flex flex-col gap-2" aria-busy={pending}>
      <div className="flex flex-wrap gap-1.5">
        <Button
          ref={editRef}
          size="sm"
          aria-expanded={mode === "editing"}
          disabled={pending}
          onClick={() => {
            setProblem(null);
            setNotice(null);
            setMode(mode === "editing" ? "idle" : "editing");
          }}
        >
          {t("common.edit")}
        </Button>
        <Button
          ref={switchRef}
          size="sm"
          disabled={pending}
          onClick={() => {
            if (connection.enabled && enforcedDomains !== "") {
              setMode("confirmOff");
              return;
            }
            switchTo(!connection.enabled);
          }}
        >
          {pending && mode !== "confirmRemove"
            ? t("admin.sso.connectionControls.working")
            : connection.enabled
              ? t("admin.sso.connectionControls.turnOff")
              : t("admin.sso.connectionControls.turnOn")}
        </Button>
        <Button
          ref={removeRef}
          size="sm"
          // No `danger` variant exists in the design system, so the token
          // colours the label, as the delete control does.
          className="text-bad"
          disabled={pending}
          onClick={() => {
            setProblem(null);
            setNotice(null);
            setMode("confirmRemove");
          }}
        >
          {t("common.remove")}
        </Button>
      </div>

      {mode === "confirmOff" || mode === "confirmRemove" ? (
        // A fieldset named by the question, so a screen reader announces
        // what is being asked when focus lands on its first button.
        <fieldset
          aria-labelledby={questionId}
          className="flex min-w-0 flex-col gap-2 rounded-control border border-line-2 bg-raised p-3"
          data-testid={`sso-${connection.id}-confirm`}
        >
          <p id={questionId} className="text-sm font-medium text-ink">
            {question}
          </p>
          {enforcedDomains !== "" ? (
            <p className="text-sm text-ink-2">
              {t("admin.sso.connectionControls.enforcedDomainsGoBack", {
                domains: enforcedDomains,
              })}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              ref={confirmRef}
              size="sm"
              variant="primary"
              disabled={pending}
              onClick={() =>
                mode === "confirmRemove" ? remove() : switchTo(false)
              }
            >
              {pending
                ? t("admin.sso.connectionControls.working")
                : mode === "confirmRemove"
                  ? t("admin.sso.connectionControls.removeConnection")
                  : t("admin.sso.connectionControls.turnOffConnection")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={close}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </fieldset>
      ) : null}

      {mode === "editing" ? (
        <div className="border-t border-line pt-3">
          <SSOForm
            connection={connection}
            onSaved={() => {
              setMode("idle");
              setNotice(t("admin.sso.ssoForm.providerSaved"));
            }}
            onCancel={close}
          />
        </div>
      ) : null}

      {problem ? (
        <p role="alert" className="text-xs text-bad">
          {problem}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-xs text-ink-2">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
