import type { callAction } from "@openokr/core";
import {
  Bar,
  Button,
  buttonVariants,
  Card,
  CardBody,
  CardHeader,
  dueDayLabel,
} from "@openokr/ui";
import { healthWord } from "../../lib/health-words.ts";
import type { TeamRhythm, WeekCard } from "../../lib/my-week.ts";
import { ActionForm } from "../cycle/action-form.tsx";
import { keyResultValueText } from "../goal-nodes.ts";
import { acknowledgeAll } from "../review/actions.ts";

/**
 * The parts of Home that depend on who is reading (OKRGoal UX review,
 * backlog 12): a key result owner's week, a reviewer's digest, and the
 * rhythm by team for the people who run the cycle.
 */

type Translate = (
  key: string,
  values?: Readonly<Record<string, string | number>>,
) => string;

type Streak = Awaited<ReturnType<typeof callAction<"goals.myStreak">>>;
type Obligation = Awaited<
  ReturnType<typeof callAction<"review.inbox">>
>["obligations"][number];

/** "My week": the reader's goals as check-in cards, due first. */
export function MyWeek({
  cards,
  streak,
  heading,
  t,
  locale,
}: {
  readonly cards: readonly WeekCard[];
  readonly streak: Streak;
  /** `h1` where it is the page's own heading, `h2` above the cockpit. */
  readonly heading: "h1" | "h2";
  readonly t: Translate;
  readonly locale: string;
}) {
  const Heading = heading;
  return (
    <Card>
      <CardHeader className="flex-col items-start gap-0.5">
        <Heading className="text-lg font-bold text-ink">
          {t("home.myWeek.title")}
        </Heading>
        <p className="text-xs font-semibold text-ink-2">
          {streak.pausedBy
            ? t("checkIn.streak.paused", { title: streak.pausedBy.title })
            : streak.periods === 0
              ? t("checkIn.streak.none")
              : streak.periods === 1
                ? t("checkIn.streak.one")
                : t("checkIn.streak.other", { count: streak.periods })}
        </p>
      </CardHeader>
      <CardBody className="flex flex-col gap-2.5">
        {cards.length === 0 ? (
          <p className="text-sm text-ink-3">{t("home.myWeek.empty")}</p>
        ) : (
          cards.map(({ goal, action, href }) => (
            <div
              key={goal.id}
              className="flex flex-col gap-1.5 rounded-md border border-line p-2.5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="flex min-w-0 flex-col">
                  <a
                    href={`/goals/${goal.id}`}
                    className="text-sm font-semibold text-ink hover:underline"
                  >
                    {goal.title}
                  </a>
                  <span className="text-xs text-ink-3">
                    {[
                      healthWord(t, goal.health),
                      goal.nextCheckInOn === null || goal.daysPastDue === null
                        ? null
                        : goal.daysPastDue > 0
                          ? t("checkIn.overdueBy", {
                              days:
                                goal.daysPastDue === 1
                                  ? t("common.count.dayOne", { count: 1 })
                                  : t("common.count.dayOther", {
                                      count: goal.daysPastDue,
                                    }),
                            })
                          : t("checkIn.dueOn", {
                              date: dueDayLabel(
                                goal.nextCheckInOn,
                                -goal.daysPastDue,
                                locale,
                              ),
                            }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <a
                  href={href}
                  className={buttonVariants({
                    variant: action === "checkIn" ? "primary" : "default",
                    size: "sm",
                  })}
                >
                  {action === "checkIn"
                    ? t("home.myWeek.checkIn")
                    : t("home.myWeek.update")}
                </a>
              </div>
              {goal.keyResults.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {goal.keyResults.map((keyResult) => (
                    <li
                      key={keyResult.id}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="min-w-0 truncate text-ink-2">
                        {keyResult.title}
                      </span>
                      <span className="flex-none text-ink-3">
                        {keyResultValueText(t, keyResult)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))
        )}
      </CardBody>
    </Card>
  );
}

/** A reviewer's digest: every check-in waiting on them, readable in place. */
export function TeamDigest({
  owed,
  t,
}: {
  readonly owed: readonly Obligation[];
  readonly t: Translate;
}) {
  const ids = owed.flatMap((item) => (item.checkInId ? [item.checkInId] : []));
  return (
    <Card>
      <CardHeader className="justify-between">
        <h2 className="text-sm font-bold text-ink">
          {t("home.digest.title", { count: owed.length })}
        </h2>
        <span className="flex items-center gap-2">
          <a href="/review" className="text-xs text-brand-text underline">
            {t("home.digest.openUpdates")}
          </a>
          {ids.length > 1 ? (
            <ActionForm action={acknowledgeAll}>
              {ids.map((id) => (
                <input key={id} type="hidden" name="checkInId" value={id} />
              ))}
              <Button type="submit" size="sm">
                {t("review.acknowledgeAll", { count: ids.length })}
              </Button>
            </ActionForm>
          ) : null}
        </span>
      </CardHeader>
      <CardBody className="flex flex-col gap-1.5">
        {owed.map((item) => (
          <div key={item.id} className="flex flex-col text-xs">
            <a
              href={item.href}
              className="font-semibold text-ink hover:underline"
            >
              {item.title}
            </a>
            {item.preview?.excerpt ? (
              <span className="line-clamp-2 text-ink-3">
                {item.preview.excerpt}
              </span>
            ) : null}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

/** The cockpit's first card: each team's rhythm, weakest first. */
export function RhythmByTeam({
  rows,
  t,
}: {
  readonly rows: readonly TeamRhythm[];
  readonly t: Translate;
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-bold text-ink">{t("home.rhythm.title")}</h2>
      </CardHeader>
      <CardBody className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.spaceId} className="flex items-center gap-2.5 text-xs">
            <a
              href={`/spaces/${row.spaceId}`}
              className="w-40 flex-none truncate font-semibold text-ink hover:underline"
            >
              {row.name}
            </a>
            <Bar
              value={row.current}
              max={row.total}
              label={t("home.rhythm.row", {
                current: row.current,
                total: row.total,
              })}
              className="h-1.5 flex-1"
            />
            <span className="flex-none text-ink-3">
              {t("home.rhythm.row", { current: row.current, total: row.total })}
            </span>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
