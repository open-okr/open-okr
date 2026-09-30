"use client";

import { Button, Card, CardBody, useTranslations } from "@openokr/ui";
import { TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { Component, type ReactNode, useTransition } from "react";

/**
 * One card's error state, with the rest of the screen left standing
 * (completeness review M-22).
 *
 * **A segment boundary replaces the whole panel**, which is right when the
 * page's own read failed and wrong when one card among eight did. The space
 * home reads its goals and its KPI trees in cards of their own, and a failure
 * in either should cost that card and nothing else: the team's week, the
 * blockers and the sessions are still the answer somebody came for.
 *
 * **What it says is the same as `SegmentError`**: which card, that it is ours
 * to fix, and a way to try again. The failure itself is logged by the server
 * that rendered it, and the digest is the reference that ties a report here
 * to that line.
 */

interface State {
  readonly error: (Error & { digest?: string }) | null;
}

export class SectionBoundary extends Component<
  {
    /** The catalogue key of the whole heading, "We could not load …". */
    readonly headingKey: string;
    readonly children: ReactNode;
  },
  State
> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override render() {
    if (this.state.error) {
      return (
        <SectionFailed
          headingKey={this.props.headingKey}
          digest={this.state.error.digest}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}

/** The card a failed section leaves, with a retry that reads it again. */
export function SectionFailed({
  headingKey,
  digest,
  onRetry,
}: {
  readonly headingKey: string;
  readonly digest?: string | undefined;
  readonly onRetry: () => void;
}) {
  const { t } = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Card role="alert">
      <CardBody className="flex flex-col items-start gap-2.5">
        <span className="flex items-center gap-2">
          <TriangleAlert className="size-4 text-bad" aria-hidden="true" />
          <h2 className="text-sm font-bold text-ink">{t(headingKey)}</h2>
        </span>
        <p className="text-sm text-ink-3">{t("segmentError.thisIsOurFault")}</p>
        <Button
          variant="primary"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(() => {
              // Read the page again from the server, then draw the card again.
              router.refresh();
              onRetry();
            })
          }
        >
          {t("common.tryAgain")}
        </Button>
        {digest ? (
          <p className="text-xs text-ink-4">
            {t("common.reference", { digest })}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
