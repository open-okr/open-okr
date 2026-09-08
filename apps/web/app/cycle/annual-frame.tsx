import { Button, Card, CardBody, CardHeader, Chip } from "@openokr/ui";
import { ActionForm } from "./action-form.tsx";
import { setFrame } from "./frame-actions.ts";

/**
 * Phase 0, the annual frame (UIUX-PLAN.md §6 S-05, P6-G14).
 *
 * **The table held a mission and nothing could put one in it.** Migration 0020
 * gave `annual_frames` mission, vision, strategy and not-doing columns with a
 * version beside each, back at P3-T02, and `frame.read` returned four scalars
 * and a list of strategies. So phase 0 rendered a card saying the surface
 * arrives later while the storage for it had been waiting for months. That is
 * what made B-03 a blocker rather than a missing screen.
 *
 * **A replacement supersedes rather than edits**, which is METHOD.md §2.1's
 * rule that the frame is "never rewritten mid-year". The action carries the
 * prose forward when this form does not name it, so adding a strategy in March
 * does not silently drop the mission somebody wrote in January.
 *
 * **Two to five strategies, and the form says so rather than enforcing it.**
 * §2.1 gives that range as the practice; the action accepts up to twenty
 * because refusing a sixth mid-conversation would stop a workshop rather than
 * coach it. The Coach's own check is where that judgement belongs.
 */

/** The plain text of one rich-text field, for a textarea. */
function asText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  // Editor JSON. Only the paragraph text is offered back, which is what a
  // plain textarea can honestly round-trip; a member wanting formatting uses
  // the editor on a document instead.
  const walk = (node: unknown): string => {
    if (!node || typeof node !== "object") {
      return "";
    }
    const record = node as { text?: unknown; content?: unknown };
    if (typeof record.text === "string") {
      return record.text;
    }
    if (Array.isArray(record.content)) {
      return record.content.map(walk).join("");
    }
    return "";
  };
  const doc = value as { content?: unknown };
  return Array.isArray(doc.content)
    ? doc.content.map((node) => walk(node)).join("\n")
    : "";
}

export interface Frame {
  readonly yearLabel: string;
  readonly horizonLabel: string | null;
  readonly agreed: boolean;
  readonly mission: unknown;
  readonly vision: unknown;
  readonly strategy: unknown;
  readonly notDoing: unknown;
  readonly strategies: readonly {
    readonly id: string;
    readonly text: string;
    readonly note: string | null;
  }[];
}

export function AnnualFrame({
  frame,
  canEdit,
}: {
  readonly frame: Frame | null;
  readonly canEdit: boolean;
}) {
  const strategies = frame?.strategies ?? [];

  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardHeader className="justify-between">
          <div className="flex min-w-0 flex-col">
            <h2 className="text-sm font-bold text-ink">The annual frame</h2>
            <p className="text-xs text-ink-3">
              Where the year is going, in the words the organisation uses. Every
              quarter's set is drafted against this, and the alignment score
              reads it.
            </p>
          </div>
          {frame ? (
            <Chip tone={frame.agreed ? "ok" : "warn"}>
              {frame.agreed ? "agreed" : "not agreed yet"}
            </Chip>
          ) : (
            <Chip tone="neutral">not written</Chip>
          )}
        </CardHeader>
        <CardBody>
          {frame === null ? (
            <p className="text-sm text-ink-2">
              Nothing written for this year yet. A frame is what phase 0 is for,
              and the drafting phase reads it.
            </p>
          ) : null}

          {canEdit ? (
            <ActionForm action={setFrame} className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <label className="flex flex-col gap-1 text-xs text-ink-3">
                  Year
                  <input
                    name="yearLabel"
                    required
                    defaultValue={
                      frame?.yearLabel ?? String(new Date().getFullYear())
                    }
                    className="w-32 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-ink-3">
                  Horizon, the mid-term this year serves
                  <input
                    name="horizonLabel"
                    defaultValue={frame?.horizonLabel ?? ""}
                    placeholder="three years out, say"
                    className="w-72 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                  />
                </label>
                <label className="flex items-end gap-2 pb-1.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    name="agreed"
                    defaultChecked={frame?.agreed ?? false}
                    className="size-4"
                  />
                  Agreed
                </label>
              </div>

              {(
                [
                  ["mission", "Mission", "Why this organisation exists."],
                  ["vision", "Vision", "What it is trying to become."],
                  [
                    "strategy",
                    "Mid-term strategy",
                    "How it intends to get there, over the horizon above.",
                  ],
                  [
                    "notDoing",
                    "Not doing this year",
                    "The list that makes the rest credible. §2.1 asks for it by name.",
                  ],
                ] as const
              ).map(([name, label, hint]) => (
                <label
                  key={name}
                  className="flex flex-col gap-1 text-xs text-ink-3"
                >
                  {label}
                  <span className="text-ink-4">{hint}</span>
                  <textarea
                    name={name}
                    rows={3}
                    defaultValue={asText(frame?.[name])}
                    className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                  />
                </label>
              ))}

              <fieldset className="flex flex-col gap-2 rounded-lg border border-line p-3">
                <legend className="px-1 text-xs font-bold uppercase tracking-wide text-ink-3">
                  Strategies
                </legend>
                <p className="text-xs text-ink-3">
                  Two to five, each with what it means in practice. Saving
                  replaces the whole list, which is how a set is edited.
                </p>
                {[0, 1, 2, 3, 4].map((index) => (
                  <div key={index} className="flex flex-wrap gap-2">
                    <input
                      name="strategyText"
                      defaultValue={strategies[index]?.text ?? ""}
                      placeholder={`Strategy ${index + 1}`}
                      className="w-72 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                    />
                    <input
                      name="strategyNote"
                      defaultValue={strategies[index]?.note ?? ""}
                      placeholder="what it means in practice"
                      className="w-96 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                    />
                  </div>
                ))}
              </fieldset>

              <Button type="submit" variant="default" size="sm">
                {frame ? "Replace the frame" : "Write the frame"}
              </Button>
            </ActionForm>
          ) : (
            <ReadOnlyFrame frame={frame} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function ReadOnlyFrame({ frame }: { readonly frame: Frame | null }) {
  if (!frame) {
    return (
      <p className="text-xs text-ink-3">
        Writing the frame is the facilitator's, so this is what there is until
        they do.
      </p>
    );
  }
  const fields: readonly (readonly [string, string])[] = [
    ["Mission", asText(frame.mission)],
    ["Vision", asText(frame.vision)],
    ["Mid-term strategy", asText(frame.strategy)],
    ["Not doing this year", asText(frame.notDoing)],
  ];
  return (
    <div className="flex flex-col gap-2.5">
      {fields.map(([label, text]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold text-ink-3">{label}</span>
          <p className="whitespace-pre-line text-sm text-ink-2">
            {text === "" ? "Not written yet." : text}
          </p>
        </div>
      ))}
      {frame.strategies.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-ink-3">Strategies</span>
          <ul className="flex flex-col gap-1">
            {frame.strategies.map((one) => (
              <li key={one.id} className="text-sm text-ink-2">
                {one.text}
                {one.note ? (
                  <span className="ml-1.5 text-xs text-ink-3">{one.note}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
