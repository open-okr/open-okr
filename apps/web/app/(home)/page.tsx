import { ACCESS_LEVELS, callAction, resourceIdentifier } from "@openokr/core";
import { redirect } from "next/navigation";
import { workspaceReaderLevel } from "../../lib/access";
import { getPool } from "../../lib/auth";
import { seesCycle } from "../../lib/cycle-visibility.ts";
import { instanceIssuer } from "../../lib/issuer";
import { myWeek, rhythmByTeam } from "../../lib/my-week.ts";
import { getTranslations } from "../../lib/translations";
import { requireWorkspace } from "../../lib/workspace";
import { AgentSetupPill } from "../agent-setup-pill.tsx";
import { TrustedDomainOffers } from "../trusted-domain-offers.tsx";
import { WorkMapScreen } from "../work-map-screen.tsx";
import { MyWeek, RhythmByTeam, TeamDigest } from "./role-home.tsx";

/**
 * Home, by role (OKRGoal UX review, backlog 12; UIUX-PLAN.md §4 S-01).
 *
 * The review: "Give each role its own home ('My week') instead of showing
 * everyone the company Work Map." Every member opens on their week, the goals
 * they champion as check-in cards. A reviewer with check-ins waiting sees them
 * here to read and acknowledge. The people who run the cycle (administrators,
 * space coordinators and managers) also get the cockpit: each team's rhythm,
 * then the phase, the gates, the numbers and the company tree that used to be
 * everybody's front door. Everybody else reaches the tree at `/map`, the Map
 * tab of Goals.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ node?: string; cycle?: string; scope?: string }>;
}) {
  const { t, locale } = await getTranslations();

  const { session, workspace } = await requireWorkspace();
  const context = {
    pool: getPool(),
    workspaceId: workspace.workspaceId,
    actor: { kind: "human" as const, userId: session.user.id },
  };

  const level = await workspaceReaderLevel(
    workspace.workspaceId,
    workspace.memberId,
  );

  // **Somebody who holds nothing on the workspace itself is a guest**
  // (completeness review M-22), and `workspaceReaderLevel` has already sent
  // them to the spaces they can open, which is the one they were asked into.

  const welcome = await callAction(context, "settings.readForMember", {});
  // **Only somebody who can finish the setup is sent to it** (P8-G05a). S-34
  // refuses anybody below `full` and sends them back here, so redirecting a
  // member below it produces an infinite loop between the two screens rather
  // than a wrong page. The pair has to agree on who the screen is for, and the
  // welcome screen is the one that decides.
  //
  // This was hidden until P8-G05: the read above was declared `full`, so for an
  // ordinary member it threw and this line was never reached. Fixing the read
  // turned a broken screen into a loop, which is the worse failure of the two.
  if (
    level >= ACCESS_LEVELS.full &&
    welcome.settings.onboardingDone === false
  ) {
    redirect("/welcome");
  }
  const query = await searchParams;

  const spaces = await callAction(context, "spaces.list", {});
  const runsCycle = seesCycle({
    administers: level >= ACCESS_LEVELS.full,
    spaceRoles: spaces.map((space) => space.ownRole),
  });

  const mine = await callAction(context, "goals.list", {
    mine: true,
    includeClosed: false,
  });
  const cards = myWeek(mine.goals, workspace.memberId);
  const streak = await callAction(context, "goals.myStreak", {});
  const owed = (
    await callAction(context, "review.inbox", {})
  ).obligations.filter((item) => item.kind === "acknowledgement");

  const current = runsCycle
    ? await callAction(context, "cycles.current", { mode: "quarterly" })
    : null;
  const rhythm = current
    ? rhythmByTeam(
        (
          await callAction(context, "goals.list", {
            cycleId: current.id,
            includeClosed: false,
          })
        ).goals,
        spaces.map((space) => ({ id: space.id, name: space.name })),
      )
    : [];

  return (
    <div className="flex w-full flex-col gap-3.5">
      {/* Completeness review M-34: the workspaces this member's domain
          admits, drawn only when there are some. */}
      <TrustedDomainOffers
        userId={session.user.id}
        email={session.user.email}
      />

      {/* docs/design/agent-setup-prompt.md §3: a prompt a member pastes into
          their own agent, which then connects itself through OAuth. */}
      <AgentSetupPill
        endpoint={resourceIdentifier(instanceIssuer())}
        sessionId={session.session.id}
      />

      <MyWeek
        cards={cards}
        streak={streak}
        // The cockpit's tree carries the page's own heading; without it,
        // the week is the page.
        heading={runsCycle ? "h2" : "h1"}
        t={t}
        locale={locale}
      />

      {owed.length > 0 ? <TeamDigest owed={owed} t={t} /> : null}

      {runsCycle ? (
        <>
          <RhythmByTeam rows={rhythm} t={t} />
          <WorkMapScreen query={query} basePath="/" />
        </>
      ) : (
        <p className="text-xs">
          <a className="text-brand-text underline" href="/map">
            {t("home.map.link")}
          </a>
        </p>
      )}
    </div>
  );
}
