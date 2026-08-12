import { SUGGESTED_TIMELINE } from "@openokr/method";
import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { ActionForm } from "./action-form.tsx";
import { distributePack, savePackNote, togglePackItem } from "./actions.ts";

/**
 * Phase 1's work (UIUX-PLAN.md §4 S-06): the seven-item input pack with its
 * distribution confirmation, the named roles, and the suggested timeline for the
 * mode.
 *
 * METHOD.md §2.6 calls the incomplete pack "the single most common failure point
 * in an OKR programme", which is why this is a checklist somebody has to tick
 * item by item rather than one "we are ready" switch. The seven labels come from
 * the method package, so the list cannot drift from the document.
 */

export interface PackItem {
  readonly itemKey: number;
  readonly label: string;
  readonly gathered: boolean;
  readonly note: string | null;
}

export function InputPack({
  cycleId,
  mode,
  items,
  distributedAt,
  sponsor,
  facilitator,
  canEdit,
}: {
  readonly cycleId: string;
  readonly mode: "annual" | "quarterly";
  readonly items: readonly PackItem[];
  readonly distributedAt: string | null;
  readonly sponsor: { readonly name: string } | null;
  readonly facilitator: { readonly name: string } | null;
  readonly canEdit: boolean;
}) {
  const gathered = items.filter((item) => item.gathered).length;

  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardHeader className="justify-between">
          <h2 className="text-sm font-bold text-ink">Input pack</h2>
          <Chip tone={gathered === items.length ? "ok" : "warn"}>
            {gathered} of {items.length}
          </Chip>
        </CardHeader>
        <CardBody className="flex flex-col divide-y divide-line p-0">
          {items.map((item) => (
            <div
              key={item.itemKey}
              className="flex flex-col gap-1.5 px-3.5 py-3"
            >
              <div className="flex items-start gap-2.5">
                {canEdit ? (
                  <ActionForm
                    action={togglePackItem}
                    className="flex-none pt-0.5"
                  >
                    <input type="hidden" name="cycleId" value={cycleId} />
                    <input type="hidden" name="itemKey" value={item.itemKey} />
                    <input
                      type="hidden"
                      name="gathered"
                      value={String(item.gathered)}
                    />
                    <button
                      type="submit"
                      aria-pressed={item.gathered}
                      aria-label={
                        item.gathered
                          ? `Mark "${item.label}" as not gathered`
                          : `Mark "${item.label}" as gathered`
                      }
                      className={
                        item.gathered
                          ? "flex size-5 items-center justify-center rounded-md bg-ok text-xs text-white"
                          : "flex size-5 items-center justify-center rounded-md border border-dashed border-bad-dot text-xs text-transparent"
                      }
                    >
                      ✓
                    </button>
                  </ActionForm>
                ) : (
                  <span
                    aria-hidden="true"
                    className={
                      item.gathered
                        ? "mt-0.5 flex size-5 flex-none items-center justify-center rounded-md bg-ok text-xs text-white"
                        : "mt-0.5 flex size-5 flex-none items-center justify-center rounded-md border border-dashed border-bad-dot"
                    }
                  >
                    {item.gathered ? "✓" : ""}
                  </span>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-sm font-semibold text-ink">
                    {item.label}
                  </span>
                  {canEdit ? (
                    <ActionForm
                      action={savePackNote}
                      className="flex items-center gap-1.5"
                    >
                      <input type="hidden" name="cycleId" value={cycleId} />
                      <input
                        type="hidden"
                        name="itemKey"
                        value={item.itemKey}
                      />
                      <input
                        type="hidden"
                        name="gathered"
                        value={String(item.gathered)}
                      />
                      <input
                        name="note"
                        defaultValue={item.note ?? ""}
                        placeholder="Where it is, or who is bringing it"
                        aria-label={`Note for "${item.label}"`}
                        className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink-2 placeholder:text-ink-4"
                      />
                      <Button
                        type="submit"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                      >
                        Save
                      </Button>
                    </ActionForm>
                  ) : item.note ? (
                    <span className="text-xs text-ink-3">{item.note}</span>
                  ) : null}
                </div>
                <Chip tone={item.gathered ? "ok" : "bad"}>
                  {item.gathered ? "Gathered" : "Missing"}
                </Chip>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="justify-between">
          <h2 className="text-sm font-bold text-ink">Distribution</h2>
          {distributedAt ? (
            <Chip tone="ok">Distributed</Chip>
          ) : (
            <Chip tone="warn">Not sent</Chip>
          )}
        </CardHeader>
        <CardBody className="flex flex-col gap-2.5">
          <p className="text-sm text-ink-2">
            §2.6 asks for the pack in every participant's hands three working
            days before session one. An incomplete pack delivered on time beats
            a complete pack delivered late.
          </p>
          {distributedAt ? (
            <p className="text-xs text-ink-3">
              Sent {new Date(distributedAt).toLocaleString()}
            </p>
          ) : null}
          {canEdit ? (
            <ActionForm action={distributePack}>
              <input type="hidden" name="cycleId" value={cycleId} />
              <Button
                type="submit"
                variant={distributedAt ? "ghost" : "primary"}
              >
                {distributedAt ? "Record a new send" : "Confirm distribution"}
              </Button>
            </ActionForm>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid gap-4.5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">Roles</h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-2.5 text-sm">
            <div className="flex flex-col">
              <span className="font-semibold text-ink">
                {sponsor?.name ?? "No sponsor named"}
              </span>
              <span className="text-xs text-ink-3">
                Sponsor · decides and unblocks. Escalations land here
              </span>
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-ink">
                {facilitator?.name ?? "No facilitator named"}
              </span>
              <span className="text-xs text-ink-3">
                Facilitator · guards the method. Can refuse to run Phase 4
                without a complete pack
              </span>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-bold text-ink">Suggested timeline</h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-2 p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-line border-b">
                  <th className="px-3.5 py-1.5 text-left text-xs font-bold tracking-wide text-ink-3 uppercase">
                    Weeks before
                  </th>
                  <th className="px-3.5 py-1.5 text-left text-xs font-bold tracking-wide text-ink-3 uppercase">
                    Activity
                  </th>
                </tr>
              </thead>
              <tbody>
                {SUGGESTED_TIMELINE[mode].map((row) => (
                  <tr
                    key={row.weeksBefore}
                    className="border-line border-b last:border-0"
                  >
                    <td className="px-3.5 py-2 align-top whitespace-nowrap text-xs font-semibold text-ink-3">
                      {row.weeksBefore}
                    </td>
                    <td className="px-3.5 py-2 text-ink-2">{row.activity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
