"use client";

import { Button, EmailInput, useTranslations } from "@openokr/ui";
import Link from "next/link";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { authClient } from "../../lib/auth-client";

/**
 * "Send the link again" (plan 0.8.0 S3, docs/design/email-verification.md
 * D7, D8 and §3).
 *
 * Better Auth's own `POST /api/auth/send-verification-email`, through the
 * client. It answers `{ status: true }` for an unknown, a confirmed and an
 * unconfirmed address alike, so the page says "if ... has an account waiting
 * to be confirmed" and nothing more. Sign-in is the exception: Better Auth
 * said the address is unconfirmed only after its password matched, so there
 * the answer is direct.
 *
 * After a press the button is replaced by the answer for a minute, which is
 * the per-address allowance, so pressing again at once is not offered.
 */

/** Where the link lands once it is opened (plan 0.8.0 S2). */
const LANDING = "/email-confirmed";

/** How long the button stays away after a link was asked for. */
const BUTTON_RETURNS_MS = 60_000;

/** Stands in for the address in a sentence, so the address can be bold. */
const SLOT = "\u0000";

type Answer =
  | { readonly kind: "sent"; readonly email: string }
  | { readonly kind: "refused"; readonly message: string };

/**
 * The sentence with the address in bold where its hole is. One message with
 * a hole rather than two pieces around it, so a translator can put the
 * address wherever their language wants it.
 */
function withAddress(sentence: string, email: string): ReactNode {
  const [before, after] = sentence.split(SLOT);
  return (
    <>
      {before}
      <strong className="font-semibold text-ink">{email}</strong>
      {after}
    </>
  );
}

/** Asks for a link, and holds what the answer was. */
function useResend() {
  const { t } = useTranslations();
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);

  useEffect(() => {
    if (answer?.kind !== "sent") {
      return;
    }
    const timer = setTimeout(() => setAnswer(null), BUTTON_RETURNS_MS);
    return () => clearTimeout(timer);
  }, [answer]);

  const heldFor = (seconds: number): string => {
    // The same rounding the server's own message uses: whole minutes up to
    // an hour, whole hours after.
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    if (minutes < 60) {
      return minutes === 1
        ? t("auth.resend.heldMinute")
        : t("auth.resend.heldMinutes", { minutes });
    }
    const hours = Math.ceil(minutes / 60);
    return hours === 1
      ? t("auth.resend.heldHour")
      : t("auth.resend.heldHours", { hours });
  };

  const send = async (email: string) => {
    setPending(true);
    try {
      const { error } = await authClient.sendVerificationEmail({
        email,
        callbackURL: LANDING,
      });
      if (!error) {
        setAnswer({ kind: "sent", email });
        return;
      }
      if (error.status === 429 && error.code === "VERIFICATION_RESEND_HELD") {
        const seconds = Number(
          (error as { retryAfterSeconds?: unknown }).retryAfterSeconds,
        );
        setAnswer({
          kind: "refused",
          message: heldFor(Number.isFinite(seconds) ? seconds : 60),
        });
        return;
      }
      setAnswer({
        kind: "refused",
        message:
          error.status === 429
            ? t("auth.signIn.tooManyAttempts")
            : t("auth.resend.failed"),
      });
    } catch {
      setAnswer({ kind: "refused", message: t("auth.resend.failed") });
    } finally {
      setPending(false);
    }
  };

  return { pending, answer, send };
}

/**
 * The answer, in a polite live region that is there before it is filled, so
 * a screen reader announces it. Empty, it takes no room.
 */
function AnswerLine({
  answer,
  hours,
  wording,
  spaced,
}: {
  readonly answer: Answer | null;
  readonly hours: number;
  readonly wording: "neutral" | "direct";
  /** Whether something stands above it, so it needs a gap. */
  readonly spaced: boolean;
}) {
  const { t } = useTranslations();
  return (
    <p
      role="status"
      className={`text-sm text-ink-2 ${answer && spaced ? "mt-2.5" : ""}`}
      data-testid="resend-answer"
    >
      {answer?.kind === "sent"
        ? withAddress(
            wording === "direct"
              ? t("auth.resend.onItsWay", { email: SLOT, hours })
              : t("auth.resend.ifWaiting", { email: SLOT, hours }),
            answer.email,
          )
        : answer?.kind === "refused"
          ? answer.message
          : null}
    </p>
  );
}

/**
 * The button for an address the page already holds: the check-your-email
 * card's, or the one typed into sign-in.
 */
export function ResendLink({
  email,
  hours,
  wording,
}: {
  readonly email: string;
  /** How long a link works, from `EMAIL_VERIFICATION_LINK_SECONDS`. */
  readonly hours: number;
  /** `direct` only where Better Auth has already said the address waits. */
  readonly wording: "neutral" | "direct";
}) {
  const { t } = useTranslations();
  const { pending, answer, send } = useResend();
  const sent = answer?.kind === "sent";
  return (
    <div className="flex flex-col">
      {sent ? null : (
        <Button
          type="button"
          variant="default"
          pending={pending}
          onClick={() => send(email)}
        >
          {pending ? t("auth.resend.sending") : t("auth.resend.again")}
        </Button>
      )}
      <AnswerLine
        answer={answer}
        hours={hours}
        wording={wording}
        spaced={!sent}
      />
    </div>
  );
}

/**
 * The form on the page an expired or broken link lands on, which knows no
 * address until one is typed.
 */
export function ResendForm({ hours }: { readonly hours: number }) {
  const { t } = useTranslations();
  const { pending, answer, send } = useResend();
  const sent = answer?.kind === "sent";
  return (
    <div className="flex flex-col">
      {sent ? null : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const email = String(
              new FormData(event.currentTarget).get("email") ?? "",
            ).trim();
            if (email !== "") {
              send(email);
            }
          }}
        >
          <EmailInput
            label={t("people.detail.profileForm.email")}
            name="email"
            autoComplete="email"
            required
          />
          <Button type="submit" variant="primary" pending={pending}>
            {pending ? t("auth.resend.sending") : t("auth.resend.newLink")}
          </Button>
        </form>
      )}
      <AnswerLine
        answer={answer}
        hours={hours}
        wording="neutral"
        spaced={!sent}
      />
      {sent ? (
        <p className="mt-2.5 text-sm text-ink-2">
          {t("auth.emailConfirmed.alreadyConfirmed")}{" "}
          <Link
            href="/sign-in"
            className="font-medium text-brand-text hover:underline"
          >
            {t("auth.emailConfirmed.signIn")}
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

/**
 * How long a link works, for the sign-in page, which is a client component
 * and cannot read the constant itself: `packages/core` must not reach a
 * client bundle. Its layout reads it on the server and provides it here.
 */
const LinkHoursContext = createContext<number | null>(null);

export function LinkHoursProvider({
  hours,
  children,
}: {
  readonly hours: number;
  readonly children: ReactNode;
}) {
  return (
    <LinkHoursContext.Provider value={hours}>
      {children}
    </LinkHoursContext.Provider>
  );
}

export function useLinkHours(): number | null {
  return useContext(LinkHoursContext);
}
