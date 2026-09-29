"use client";

/**
 * The weekly digest (METHOD.md §7.2 step 4, screen S-22, P4-T15b-a).
 *
 * **The lines are the digest. The prose is optional.** `sessions.digest` renders
 * §7.2's six parts with no provider involved, and that is what a self-hosted
 * workspace without an API key reads. When a provider can answer, the narration
 * appears above the lines and the lines stay: a reader who wants the numbers
 * should never have to trust a paragraph for them.
 *
 * **A narration that states a figure nobody measured never arrives here.** The
 * action checks every number in the prose against the numbers it computed and
 * answers null when one was invented, so this component has no judgement to make
 * about whether to trust what it was given.
 */
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  useTranslations,
} from "@openokr/ui";
import { Send, Sparkles } from "lucide-react";
import { useCallback, useState, useTransition } from "react";
import { narrateDigestAction, postDigestAction } from "./actions";

export interface WeeklyDigest {
  readonly weekStart: string;
  readonly lines: readonly string[];
  /** Providers this digest was posted to on its space's channel (M-23). */
  readonly postedTo?: readonly string[];
  /** Providers it can be posted to now: linked on the space and connected. */
  readonly postableTo?: readonly string[];
}

/** A provider as a person reads it. Brand names, the same in every language. */
const providerName = (provider: string): string =>
  provider === "teams" ? "Teams" : provider === "slack" ? "Slack" : provider;

/**
 * Posting the digest to the space's own channel (UIUX-PLAN S-22 step 4,
 * completeness review M-23).
 *
 * **Offered only where it will post somewhere.** The read says which providers
 * the space links a channel on and the workspace has connected, and an empty
 * list draws no button: a control that can only answer "nowhere to post" is a
 * question the space settings card asks better. The action refuses on its own
 * whatever this shows.
 */
function PostToChannel({
  sessionId,
  postableTo,
  postedTo,
}: {
  readonly sessionId: string;
  readonly postableTo: readonly string[];
  readonly postedTo: readonly string[];
}) {
  const { t } = useTranslations();
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{
    readonly tone: "ok" | "bad";
    readonly text: string;
  } | null>(null);

  const already = postedTo.map(providerName).join(", ");
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={pending}
          data-testid="post-digest"
          onClick={() => {
            setSaid(null);
            start(async () => {
              const result = await postDigestAction(sessionId);
              if ("error" in result) {
                setSaid({ tone: "bad", text: result.error });
                return;
              }
              const posted = result.posted.map(providerName).join(", ");
              const before = result.alreadyPosted.map(providerName).join(", ");
              setSaid({
                tone: "ok",
                text:
                  posted !== ""
                    ? t("session.detail.digest.postedTo", { channels: posted })
                    : t("session.detail.digest.alreadyPostedTo", {
                        channels: before,
                      }),
              });
            });
          }}
        >
          <Send className="size-3" />
          {pending
            ? t("session.detail.digest.posting")
            : t("session.detail.digest.postToChannel")}
        </Button>
        {already !== "" && said === null ? (
          <span className="text-xs text-ink-3">
            {t("session.detail.digest.alreadyPostedTo", { channels: already })}
          </span>
        ) : null}
      </div>
      <p className="text-xs text-ink-4">
        {t("session.detail.digest.postsTo", {
          channels: postableTo.map(providerName).join(", "),
        })}
      </p>
      {said ? (
        <p
          role={said.tone === "bad" ? "alert" : "status"}
          data-testid="post-digest-result"
          className={`text-xs ${said.tone === "bad" ? "text-bad" : "text-ok"}`}
        >
          {said.text}
        </p>
      ) : null}
    </div>
  );
}

export function Digest({
  sessionId,
  digest,
  assistAvailable,
  canPost = false,
}: {
  readonly sessionId: string;
  /** Null before step 4 has produced one. */
  readonly digest: WeeklyDigest | null;
  /** Whether a provider can narrate at all. False is the normal case. */
  readonly assistAvailable: boolean;
  /**
   * Whether this reader may post it now: the facilitator, after the close
   * (M-23). The action decides independently.
   */
  readonly canPost?: boolean;
}) {
  const { t } = useTranslations();

  const [narrative, setNarrative] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const narrate = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await narrateDigestAction(sessionId);
      setNarrative(result?.narrative ?? null);
      if (!result) {
        // Either the model declined or it stated a figure the product did not
        // compute. Both end here, and the lines below are unaffected.
        setNotice("No narration this time. The digest below is the digest.");
      }
    } catch {
      setNotice("The assist could not run. The digest below is unaffected.");
    } finally {
      setBusy(false);
    }
  }, [sessionId]);

  if (!digest) {
    return (
      <Card>
        <CardHeader>{t("session.detail.digest.digest")}</CardHeader>
        <CardBody>
          <p className="text-sm text-ink-3">
            {t("session.detail.digest.theDigestIsAssembled")}
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="justify-between">
        <span>
          {t("session.detail.digest.digestWeekOf", {
            weekStart: digest.weekStart,
          })}
        </span>
        {assistAvailable ? (
          <Button variant="ai" disabled={busy} onClick={() => void narrate()}>
            <Sparkles className="size-3" />
            {t("session.detail.digest.narrateIt")}
          </Button>
        ) : null}
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {narrative ? (
          <section
            aria-label={t("session.detail.digest.narratedDigest")}
            className="rounded-md border border-line bg-surface p-3"
          >
            <span className="mb-1.5 flex items-center gap-2">
              <Chip tone="agent">{t("common.ai")}</Chip>
              <span className="text-xs text-ink-4">
                {t("session.detail.digest.sameNumbersFewerLines")}
              </span>
            </span>
            <p className="text-sm text-ink">{narrative}</p>
          </section>
        ) : null}

        <ul
          aria-label={t("session.detail.digest.theDigest")}
          className="flex flex-col gap-1.5"
        >
          {digest.lines.map((line) => (
            <li key={line} className="text-sm text-ink-2">
              {line}
            </li>
          ))}
        </ul>

        {notice ? <p className="text-xs text-ink-4">{notice}</p> : null}

        {canPost && (digest.postableTo?.length ?? 0) > 0 ? (
          <PostToChannel
            sessionId={sessionId}
            postableTo={digest.postableTo ?? []}
            postedTo={digest.postedTo ?? []}
          />
        ) : null}
      </CardBody>
    </Card>
  );
}
