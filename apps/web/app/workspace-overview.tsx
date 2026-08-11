import { callAction, OperationError } from "@openokr/core";
import { Card, CardBody, CardHeader } from "@openokr/ui";
import { notFound } from "next/navigation";
import { getPool } from "../lib/auth";
import type { ActiveWorkspace } from "../lib/workspace";
import { RenameWorkspace } from "./rename-workspace";

/**
 * The proving dashboard's content (P1-T08).
 *
 * Everything it shows comes from one registry action, not from queries of its
 * own. That is the point of the page: the browser sees exactly what REST,
 * the command line and the agent tool catalogue will see, because all of them
 * project from the same contract.
 *
 * An async server component, rendered inside a Suspense boundary so the shell
 * paints before the database answers (§13.3, server-streamed first paint).
 */
export async function WorkspaceOverview({
  active,
}: {
  active: ActiveWorkspace;
}) {
  const { session, workspace } = active;

  let overview: Awaited<ReturnType<typeof callAction<"workspace.overview">>>;
  try {
    overview = await callAction(
      {
        pool: getPool(),
        workspaceId: workspace.workspaceId,
        actor: { kind: "human", userId: session.user.id },
      },
      "workspace.overview",
      {},
    );
  } catch (error) {
    // Forbidden reads collapse to not-found (§8.1 layer 2), so a person who
    // may not see this workspace cannot tell it apart from one that does not
    // exist. Anything else is a real fault and belongs to the error boundary.
    if (error instanceof OperationError && error.code === "not_found") {
      notFound();
    }
    throw error;
  }

  const fields: readonly [string, string][] = [
    ["Workspace", `${overview.workspace.name} (${overview.workspace.slug})`],
    ["State", overview.workspace.state],
    ["Timezone", overview.workspace.timezone],
    ["Language", overview.workspace.language],
    [
      "Your membership",
      `${overview.member.kind}, ${overview.member.status}, notified by ${overview.member.primaryChannel}`,
    ],
  ];

  return (
    <Card>
      <CardHeader>
        <h1 className="text-lg font-bold text-ink">
          Signed in as <strong>{overview.member.name}</strong>, in{" "}
          <strong>{overview.workspace.name}</strong>
        </h1>
      </CardHeader>
      <CardBody className="flex flex-col gap-3.5">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {fields.map(([label, value]) => (
            <div
              key={label}
              className="col-span-2 grid grid-cols-[10rem_1fr] gap-x-4"
            >
              <dt className="text-ink-3">{label}</dt>
              <dd className="tabular text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <RenameWorkspace name={overview.workspace.name} />
      </CardBody>
    </Card>
  );
}
