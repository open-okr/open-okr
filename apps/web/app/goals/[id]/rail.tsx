import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { HealthChip } from "../health-chip.tsx";

/**
 * The goal detail's right rail (UIUX-PLAN.md §4 S-14, P3-T10).
 *
 * What this goal is connected to: the parent it supports, the goals that hang
 * off it, the horizontal links it carries, and its own entries in the §5.4
 * dependency register. All four come from one read, because the rail is always
 * rendered whole.
 *
 * **Every block says something when it is empty**, rather than disappearing. A
 * goal with no parent is not a goal with a missing panel: it is a goal the
 * alignment score penalises 12 points for, and the rail is the right place to
 * say so.
 *
 * Watchers are not here. Subscriptions exist from P2-T07, but a watcher list on
 * a goal needs the subscribe control beside it to be worth anything, and that
 * belongs with the discussion at P3-T16.
 */

export interface Relations {
  readonly parent: {
    readonly id: string;
    readonly title: string;
    readonly level: string;
  } | null;
  readonly children: readonly {
    readonly id: string;
    readonly title: string;
    readonly level: string;
    readonly health: string;
    readonly progressPct: number;
  }[];
  readonly dependencies: readonly {
    readonly id: string;
    readonly goalId: string;
    readonly title: string;
    readonly note: string | null;
  }[];
  readonly register: readonly {
    readonly id: string;
    readonly keyResultTitle: string;
    readonly provider: string;
    readonly confirmed: boolean;
    readonly riskOwnerName: string | null;
    readonly blocksPublish: boolean;
  }[];
}

export function Rail({
  relations,
  level,
}: {
  readonly relations: Relations;
  /** This goal's own level, so the orphan note can name it. */
  readonly level: string;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <Card>
        <CardHeader>
          <h2 className="text-sm font-bold text-ink">Supports</h2>
        </CardHeader>
        <CardBody>
          {relations.parent ? (
            <a
              href={`/goals/${relations.parent.id}`}
              className="flex flex-col gap-0.5"
            >
              <span className="text-sm text-ink hover:underline">
                {relations.parent.title}
              </span>
              <span className="text-xs text-ink-3">
                {relations.parent.level}
              </span>
            </a>
          ) : level === "company" ? (
            <p className="text-xs text-ink-3">
              A company objective anchors the tree. It supports nothing above it
              by design.
            </p>
          ) : (
            <p className="text-xs text-ink-3">
              Nothing. A {level} goal with no parent costs the alignment score
              12 points, because it supports nothing above it.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="justify-between">
          <h2 className="text-sm font-bold text-ink">Supported by</h2>
          <Chip tone="neutral">{relations.children.length}</Chip>
        </CardHeader>
        <CardBody className="flex flex-col gap-1.5">
          {relations.children.length === 0 ? (
            <p className="text-xs text-ink-3">
              No goals hang off this one yet.
            </p>
          ) : (
            relations.children.map((child) => (
              <a
                key={child.id}
                href={`/goals/${child.id}`}
                className="flex items-center justify-between gap-2"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-ink hover:underline">
                    {child.title}
                  </span>
                  <span className="text-xs text-ink-3">
                    {child.level} · {Math.round(child.progressPct)}%
                  </span>
                </span>
                <HealthChip health={child.health} />
              </a>
            ))
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="justify-between">
          <h2 className="text-sm font-bold text-ink">Depends on</h2>
          <Chip tone="neutral">{relations.dependencies.length}</Chip>
        </CardHeader>
        <CardBody className="flex flex-col gap-1.5">
          {relations.dependencies.length === 0 ? (
            <p className="text-xs text-ink-3">
              No horizontal links. A department whose whole subtree has none is
              flagged as a possible silo.{" "}
              <a className="underline" href="/goals/studio">
                Add one in the studio
              </a>
              .
            </p>
          ) : (
            relations.dependencies.map((dependency) => (
              <a
                key={dependency.id}
                href={`/goals/${dependency.goalId}`}
                className="flex flex-col gap-0.5"
              >
                <span className="text-sm text-ink hover:underline">
                  {dependency.title}
                </span>
                {dependency.note ? (
                  <span className="text-xs text-ink-3">{dependency.note}</span>
                ) : null}
              </a>
            ))
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="justify-between">
          <h2 className="text-sm font-bold text-ink">Dependency register</h2>
          <Chip
            tone={
              relations.register.some((entry) => entry.blocksPublish)
                ? "bad"
                : "neutral"
            }
          >
            {relations.register.length}
          </Chip>
        </CardHeader>
        <CardBody className="flex flex-col gap-1.5">
          {relations.register.length === 0 ? (
            <p className="text-xs text-ink-3">
              Nothing recorded. A key result that needs another team to deliver
              belongs here, or publish gate 4 has nothing to check.
            </p>
          ) : (
            relations.register.map((entry) => (
              <div key={entry.id} className="flex flex-col gap-0.5">
                <span className="text-sm text-ink">{entry.keyResultTitle}</span>
                <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                  <span>{entry.provider}</span>
                  {entry.confirmed ? (
                    <Chip tone="ok">confirmed</Chip>
                  ) : entry.riskOwnerName ? (
                    <Chip tone="warn">risk: {entry.riskOwnerName}</Chip>
                  ) : (
                    <Chip tone="bad">blocks publishing</Chip>
                  )}
                </span>
              </div>
            ))
          )}
        </CardBody>
      </Card>
    </div>
  );
}
