import { ACCESS_LEVELS, callAction } from "@openokr/core";
import { Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import Link from "next/link";
import { resolveAccessLevelFor } from "../../lib/access";
import { AppShellLayout } from "../../lib/app-shell.tsx";
import { getPool } from "../../lib/auth";
import { requireWorkspace } from "../../lib/workspace";
import { ActionForm } from "../cycle/action-form.tsx";
import {
  createInitiativeAction,
  setCapacityAction,
  setStatusAction,
} from "./actions.ts";
import { InlineSelect } from "./inline-select.tsx";
import {
  CAPACITY_LABEL,
  CAPACITY_OPTIONS,
  CAPACITY_TONE,
  STATUS_LABEL,
  STATUS_OPTIONS,
} from "./labels.ts";

/**
 * The initiative list (UIUX-PLAN.md §6 S-26, P5-T10b).
 *
 * **An initiative is work, and this screen never pretends otherwise.** There is
 * no progress bar and no percentage: the column exists and reads zero until
 * P5-T11 counts tasks, and drawing a bar that is always empty would be worse
 * than drawing nothing. What the row does carry is the capacity verdict, because
 * that is the one field publish gate five reads (METHOD.md §5.5).
 *
 * Every filter is a link rather than client state, which is the rule the goals
 * explorer already follows: a filtered view is a URL somebody can send to the
 * person who needs to see it.
 */

type Initiative = Awaited<
  ReturnType<typeof callAction<"initiatives.list">>
>[number];

export default async function InitiativesPage({
  searchParams,
}: {
  searchParams: Promise<{
    space?: string;
    status?: string;
    capacity?: string;
    keyResult?: string;
  }>;
}) {
  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };
  const query = await searchParams;

  const level = await resolveAccessLevelFor(
    workspace.workspaceId,
    workspace.memberId,
  );
  const canEdit = level >= ACCESS_LEVELS.edit;

  // Validated against the lists rather than passed through, so a hand-edited
  // URL cannot ask for a status the product does not have.
  const status = STATUS_OPTIONS.find((one) => one.value === query.status);
  const capacity = CAPACITY_OPTIONS.find(
    (one) => one.value !== "" && one.value === query.capacity,
  );

  const spaces = await callAction(context, "spaces.list", {});
  const space = spaces.find((one) => one.id === query.space);

  const initiatives = await callAction(context, "initiatives.list", {
    ...(space ? { spaceId: space.id } : {}),
    ...(status ? { status: status.value } : {}),
    ...(capacity && capacity.value !== ""
      ? { capacity: capacity.value as "fits" | "tight" | "exceeds" }
      : {}),
  });

  // Only people. Every workspace ships with two agent members, and an agent is
  // not somebody who can be accountable for a project (AI-NATIVE-PLAN.md §1.3).
  // The action refuses one too; this is what stops the picker offering it.
  const members = canEdit
    ? (await callAction(context, "people.directory", {})).filter(
        (one) => one.kind === "human",
      )
    : [];

  const href = (patch: Record<string, string | null>): string => {
    const next = new URLSearchParams();
    const merged = {
      space: space?.id ?? null,
      status: status?.value ?? null,
      capacity: capacity?.value ?? null,
      ...patch,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value) {
        next.set(key, value);
      }
    }
    const search = next.toString();
    return search === "" ? "/initiatives" : `/initiatives?${search}`;
  };

  // The difference between "nothing has been planned" and "your filters left
  // nothing" is knowable from the query alone, and getting it wrong is what
  // made the goals explorer claim an empty cycle that held two goals.
  const filtered = Boolean(space || status || capacity);

  return (
    <AppShellLayout>
      <div className="flex w-full flex-col gap-3.5">
        <Card>
          <CardHeader className="justify-between">
            <div className="flex min-w-0 flex-col">
              <h1 className="text-lg font-bold text-ink">Initiatives</h1>
              <p className="text-xs text-ink-3" data-testid="initiative-count">
                {initiatives.length === 0
                  ? filtered
                    ? "No initiative matches these filters."
                    : "No work is recorded against a key result yet."
                  : `${initiatives.length} ${
                      initiatives.length === 1 ? "initiative" : "initiatives"
                    }, each one work somebody owns.`}
              </p>
            </div>
          </CardHeader>

          <CardBody className="flex flex-col gap-3">
            <Filters
              href={href}
              spaces={spaces}
              activeSpace={space?.id ?? null}
              activeStatus={status?.value ?? null}
              activeCapacity={capacity?.value ?? null}
            />

            {initiatives.length === 0 ? (
              <p className="rounded-md border border-line border-dashed px-3 py-6 text-center text-sm text-ink-3">
                {filtered
                  ? "Clear a filter to see the rest."
                  : "METHOD.md §5.5 asks a facilitator to record the main initiatives that will move each key result. This is where they go."}
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {initiatives.map((initiative) => (
                  <Row
                    key={initiative.id}
                    initiative={initiative}
                    canEdit={canEdit}
                  />
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {canEdit ? (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-bold text-ink">Add an initiative</h2>
            </CardHeader>
            <CardBody>
              <ActionForm
                action={createInitiativeAction}
                className="flex flex-col gap-2"
              >
                <label
                  className="text-xs font-semibold text-ink-2"
                  htmlFor="title"
                >
                  What work is this
                </label>
                <input
                  id="title"
                  name="title"
                  required
                  maxLength={500}
                  placeholder="Rebuild the activation flow"
                  className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
                />

                <div className="flex flex-wrap gap-2">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
                    Space
                    <select
                      name="spaceId"
                      className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                    >
                      {spaces.map((one) => (
                        <option key={one.id} value={one.id}>
                          {one.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
                    Owner
                    <select
                      name="ownerId"
                      defaultValue={workspace.memberId}
                      className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                    >
                      {members.map((one) => (
                        <option key={one.id} value={one.id}>
                          {one.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
                    Starts
                    <input
                      type="date"
                      name="startsOn"
                      className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                    />
                  </label>

                  <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
                    Ends
                    <input
                      type="date"
                      name="endsOn"
                      className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                    />
                  </label>
                </div>

                <button
                  type="submit"
                  className="self-start rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-on-brand"
                >
                  Add
                </button>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </AppShellLayout>
  );
}

function Filters({
  href,
  spaces,
  activeSpace,
  activeStatus,
  activeCapacity,
}: {
  readonly href: (patch: Record<string, string | null>) => string;
  readonly spaces: readonly { readonly id: string; readonly name: string }[];
  readonly activeSpace: string | null;
  readonly activeStatus: string | null;
  readonly activeCapacity: string | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <FilterRow label="Space">
        <FilterLink href={href({ space: null })} active={activeSpace === null}>
          Every space
        </FilterLink>
        {spaces.map((space) => (
          <FilterLink
            key={space.id}
            href={href({ space: space.id })}
            active={activeSpace === space.id}
          >
            {space.name}
          </FilterLink>
        ))}
      </FilterRow>

      <FilterRow label="Status">
        <FilterLink
          href={href({ status: null })}
          active={activeStatus === null}
        >
          Any
        </FilterLink>
        {STATUS_OPTIONS.map((option) => (
          <FilterLink
            key={option.value}
            href={href({ status: option.value })}
            active={activeStatus === option.value}
          >
            {option.label}
          </FilterLink>
        ))}
      </FilterRow>

      <FilterRow label="Capacity">
        <FilterLink
          href={href({ capacity: null })}
          active={activeCapacity === null}
        >
          Any
        </FilterLink>
        {CAPACITY_OPTIONS.filter((option) => option.value !== "").map(
          (option) => (
            <FilterLink
              key={option.value}
              href={href({ capacity: option.value })}
              active={activeCapacity === option.value}
            >
              {option.label}
            </FilterLink>
          ),
        )}
      </FilterRow>
    </div>
  );
}

function FilterRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-16 flex-none text-xs font-semibold text-ink-3">
        {label}
      </span>
      {children}
    </div>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  readonly href: string;
  readonly active: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={
        active
          ? "rounded-full bg-brand-weak px-2.5 py-1 text-xs font-semibold text-brand-text"
          : "rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:border-brand"
      }
    >
      {children}
    </Link>
  );
}

function Row({
  initiative,
  canEdit,
}: {
  readonly initiative: Initiative;
  readonly canEdit: boolean;
}) {
  const window = [initiative.startsOn, initiative.endsOn]
    .filter((one): one is string => Boolean(one))
    .join(" to ");

  return (
    <li
      className="flex flex-wrap items-center gap-2 py-2"
      data-testid="initiative"
    >
      {/*
       * Full width on a phone, so the two controls wrap below rather than
       * competing with the title for a 375px line. Found by opening it at that
       * width: the title truncated to "Rebui…" and the owner line to "Ada L…",
       * leaving a row nobody could tell apart from the one under it.
       */}
      <div className="flex w-full min-w-0 flex-col gap-0.5 sm:w-auto sm:flex-1">
        <Link
          href={`/initiatives/${initiative.id}`}
          className="truncate text-sm font-semibold text-ink hover:text-brand-text"
        >
          {initiative.title}
        </Link>
        <p className="truncate text-xs text-ink-3">
          {initiative.spaceName} · {initiative.ownerName}
          {window === "" ? "" : ` · ${window}`}
          {initiative.keyResultIds.length === 0
            ? " · not yet behind a key result"
            : ` · ${initiative.keyResultIds.length} key result${
                initiative.keyResultIds.length === 1 ? "" : "s"
              }`}
        </p>
      </div>

      {canEdit ? (
        <>
          <InlineSelect
            label={`Status of ${initiative.title}`}
            value={initiative.status}
            options={STATUS_OPTIONS}
            onSave={setStatusAction.bind(null, initiative.id)}
          />
          <InlineSelect
            label={`Capacity of ${initiative.title}`}
            value={initiative.capacity ?? ""}
            options={CAPACITY_OPTIONS}
            onSave={setCapacityAction.bind(null, initiative.id)}
          />
        </>
      ) : (
        <>
          <Chip tone="neutral">{STATUS_LABEL[initiative.status]}</Chip>
          <Chip tone={CAPACITY_TONE[initiative.capacity ?? "unjudged"]} dot>
            {CAPACITY_LABEL[initiative.capacity ?? "unjudged"]}
          </Chip>
        </>
      )}
    </li>
  );
}
