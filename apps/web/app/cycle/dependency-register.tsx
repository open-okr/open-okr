import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { ActionForm } from "./action-form.tsx";
import {
  addDependency,
  confirmDependency,
  removeDependency,
  setDependencyRiskOwner,
} from "./actions.ts";

/**
 * The §5.4 dependency register (UIUX-PLAN.md §4 S-10, METHOD.md §5.4, P6-G17).
 *
 * **Publish gate 4 could not be satisfied from the browser until this.** The
 * gate is "every dependency is confirmed, or logged with a named risk owner",
 * `alignment.read` has returned the register since P3-T09, and all four writes
 * were registered actions with no caller anywhere. The gate's own remediation
 * link pointed at `/cycle?phase=5`, which is the page a facilitator was already
 * on, so a cycle carrying one unconfirmed dependency could not be published at
 * all. The gap audit of 7 September 2026 recorded it as B-04.
 *
 * **Blocking rows first, and the reason on each.** §5.4 gives an entry two ways
 * to be settled and they are not equivalent: confirmed means the providing team
 * has agreed, and a risk owner means nobody has agreed and somebody carries the
 * consequence. A register that showed only a tick could not tell those apart,
 * and the second is the one a facilitator has to be able to see in a quarter's
 * time.
 *
 * **A dependency is added against a key result, not a goal.** The goal-to-goal
 * links in the alignment studio are a different relationship: this is "my
 * number needs something from them", which is what a capacity conversation is
 * actually about.
 */

export interface RegisterEntry {
  readonly id: string;
  readonly keyResultId: string;
  readonly keyResultTitle: string;
  readonly goalId: string;
  readonly goalTitle: string;
  readonly provider: string;
  readonly providerSpaceId: string | null;
  readonly confirmed: boolean;
  readonly riskOwnerId: string | null;
  readonly riskOwnerName: string | null;
  readonly blocksPublish: boolean;
}

export interface RegisterKeyResult {
  readonly id: string;
  readonly title: string;
  readonly goalTitle: string;
}

export interface RegisterMember {
  readonly id: string;
  readonly name: string;
}

export interface RegisterSpace {
  readonly id: string;
  readonly name: string;
}

/** What settles an entry, and what it means. Never a bare tick. */
function stateOf(entry: RegisterEntry): {
  label: string;
  tone: "ok" | "neutral" | "warn" | "bad";
  detail: string;
} {
  if (entry.confirmed) {
    return {
      label: "Confirmed",
      tone: "ok",
      detail: "The providing team has agreed to it.",
    };
  }
  if (entry.riskOwnerId) {
    return {
      label: "Risk owned",
      tone: "warn",
      detail: `Nobody has agreed. ${entry.riskOwnerName ?? "Somebody"} carries it.`,
    };
  }
  return {
    label: "Unsettled",
    tone: "bad",
    detail: "Gate 4 is red while this is neither confirmed nor risk-owned.",
  };
}

export function DependencyRegister({
  entries,
  keyResults,
  members,
  spaces,
  canEdit,
}: {
  readonly entries: readonly RegisterEntry[];
  readonly keyResults: readonly RegisterKeyResult[];
  readonly members: readonly RegisterMember[];
  readonly spaces: readonly RegisterSpace[];
  readonly canEdit: boolean;
}) {
  // Blocking first: this panel exists to be worked down, and a facilitator
  // scrolling past twelve settled rows to find the one red one is a panel that
  // does not know what it is for.
  const ordered = [...entries].sort((a, b) =>
    a.blocksPublish === b.blocksPublish ? 0 : a.blocksPublish ? -1 : 1,
  );
  const blocking = entries.filter((entry) => entry.blocksPublish).length;

  return (
    <Card id="dependency-register">
      <CardHeader className="justify-between">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">Dependency register</h2>
          <p className="text-xs text-ink-3">
            What each key result needs from somebody else. METHOD.md §5.4, and
            publish gate 4 reads it.
          </p>
        </div>
        <Chip tone={blocking > 0 ? "bad" : "ok"}>
          {blocking > 0 ? `${blocking} unsettled` : `${entries.length} settled`}
        </Chip>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        {entries.length === 0 ? (
          <p className="text-sm text-ink-3">
            Nothing recorded. An empty register passes gate 4, and that is the
            right answer for a cycle whose key results genuinely need nothing
            from anybody. It is the wrong answer for one where nobody asked.
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {ordered.map((entry) => {
              const state = stateOf(entry);
              return (
                <li
                  key={entry.id}
                  className="flex flex-col gap-1.5 border-line border-b pb-2.5 last:border-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col">
                      <Link
                        href={`/goals/${entry.goalId}`}
                        className="text-sm text-ink hover:underline"
                      >
                        {entry.keyResultTitle}
                      </Link>
                      <span className="text-xs text-ink-4">
                        {entry.goalTitle} · needs {entry.provider}
                      </span>
                    </div>
                    <Chip tone={state.tone}>{state.label}</Chip>
                  </div>
                  <p className="text-xs text-ink-4">{state.detail}</p>

                  {canEdit ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {entry.confirmed ? null : (
                        <ActionForm action={confirmDependency}>
                          <input type="hidden" name="id" value={entry.id} />
                          <button
                            type="submit"
                            className="rounded-md bg-brand px-2 py-1 text-xs font-semibold text-on-brand"
                          >
                            Confirm
                          </button>
                        </ActionForm>
                      )}

                      <ActionForm
                        action={setDependencyRiskOwner}
                        className="flex items-center gap-1.5"
                      >
                        <input type="hidden" name="id" value={entry.id} />
                        <label className="text-xs text-ink-3">
                          Risk owner
                          <select
                            name="memberId"
                            defaultValue={entry.riskOwnerId ?? ""}
                            className="ml-1.5 rounded-md border border-line bg-surface px-1.5 py-1 text-xs text-ink"
                          >
                            <option value="">Nobody</option>
                            {members.map((member) => (
                              <option key={member.id} value={member.id}>
                                {member.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="submit"
                          className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink-2"
                        >
                          Set
                        </button>
                      </ActionForm>

                      <ActionForm action={removeDependency}>
                        <input type="hidden" name="id" value={entry.id} />
                        <button
                          type="submit"
                          className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-ink-3"
                        >
                          Remove
                        </button>
                      </ActionForm>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {canEdit && keyResults.length > 0 ? (
          <ActionForm
            action={addDependency}
            className="flex flex-col gap-2 rounded-md bg-raised p-2.5"
          >
            <h3 className="text-xs font-bold text-ink-2">
              Record a dependency
            </h3>
            <label className="flex flex-col gap-1 text-xs text-ink-3">
              Key result
              <select
                name="keyResultId"
                required
                className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              >
                {keyResults.map((keyResult) => (
                  <option key={keyResult.id} value={keyResult.id}>
                    {keyResult.goalTitle}: {keyResult.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2.5">
              <label className="flex flex-col gap-1 text-xs text-ink-3">
                Providing space
                <select
                  name="providerSpaceId"
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                >
                  <option value="">Somebody outside this workspace</option>
                  {spaces.map((space) => (
                    <option key={space.id} value={space.id}>
                      {space.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-ink-3">
                Or name them
                <input
                  name="providerText"
                  placeholder="The platform vendor, Legal, a partner"
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-xs text-ink-3">
              What is needed
              <input
                name="note"
                placeholder="The rate-limit change, by the end of week four"
                className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </label>
            <button
              type="submit"
              className="self-start rounded-md bg-brand px-2.5 py-1.5 text-xs font-semibold text-on-brand"
            >
              Add to the register
            </button>
            <p className="text-xs text-ink-4">
              A new entry is unsettled, which turns gate 4 red until somebody
              confirms it or carries it. That is the point: §5.4 asks the room
              to say out loud who is waiting on whom.
            </p>
          </ActionForm>
        ) : null}
      </CardBody>
    </Card>
  );
}
