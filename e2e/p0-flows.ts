/**
 * The P0 flows, and the spec files that prove each one (release 0.7.0 A12,
 * `docs/design/ai-off-leg.md` §5).
 *
 * REQUIREMENTS prices every module in its §3 to §5 as P0, so a P0 flow is the
 * end-to-end path through one P0 feature: the thing an organisation does with
 * it, start to finish. The end-to-end job runs the whole suite with AI off, so every file
 * here runs on every push; this list is what names them.
 *
 * **A file, not a test, is the unit.** Most specs are serial, each test
 * building on the one before, so a tag on one test could not be run alone.
 * Playwright takes file names as filters, which is how a step names them:
 *
 *   pnpm test:e2e $(node --experimental-strip-types --no-warnings e2e/p0-flows.ts)
 *
 * `apps/web/test/ai-off-leg.test.ts` fails when a file named here is renamed,
 * deleted or skipped wholesale.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface P0Flow {
  /** What an organisation does, in its words. */
  readonly flow: string;
  /** Where REQUIREMENTS prices it P0. */
  readonly requirement: string;
  /** The spec files under `e2e/` that walk it. */
  readonly specs: readonly string[];
}

export const P0_FLOWS: readonly P0Flow[] = [
  {
    flow: "Install, claim and sign in",
    requirement: "REQUIREMENTS §5 Deployment; §4 Pillar F, Admin",
    specs: ["first-run-wizard.spec.ts", "registration-to-dashboard.spec.ts"],
  },
  {
    flow: "Plan a cycle through its phases and publish past the gates",
    requirement: "REQUIREMENTS §4 Pillar A, Cycles and the planning workflow",
    specs: ["s04-annual-cycle.spec.ts", "s10-publish-gates.spec.ts"],
  },
  {
    flow: "Choose a practice profile and tune a rule",
    requirement: "REQUIREMENTS §4 Pillar A, Practice settings and profiles",
    specs: ["s36n-practice.spec.ts"],
  },
  {
    flow: "Write objectives and key results, with the Draft Coach",
    requirement: "REQUIREMENTS §4 Pillar A, Goals and key results; Pillar D, The Draft Coach",
    specs: [
      "s13-okr-editor.spec.ts",
      "s13c-okr-drafts.spec.ts",
      "s09-drafting-assists.spec.ts",
    ],
  },
  {
    flow: "Align goals",
    requirement: "REQUIREMENTS §4 Pillar A, Alignment",
    specs: ["s16-alignment-studio.spec.ts"],
  },
  {
    flow: "Track KPIs, back a key result with one, and respond to an unhealthy one",
    requirement: "REQUIREMENTS §4 Pillar A, KPIs and KPI trees",
    specs: [
      "s20c-kpi-form.spec.ts",
      "s09c-kpi-backed-key-results.spec.ts",
      "s19b-kpi-responses.spec.ts",
    ],
  },
  {
    flow: "Check in",
    requirement: "REQUIREMENTS §4 Pillar A, Check-ins",
    specs: ["s15-check-in-publish.spec.ts", "s01b-quick-check-in.spec.ts"],
  },
  {
    flow: "Run the weekly session: confidence, blockers, commitments and the digest",
    requirement:
      "REQUIREMENTS §4 Pillar B, Weekly check-in session, Blockers, Commitments",
    specs: [
      "sessions.spec.ts",
      "s12-blocker-board.spec.ts",
      "s22-weekly-digest.spec.ts",
    ],
  },
  {
    flow: "Hold the monthly and quarterly reviews",
    requirement:
      "REQUIREMENTS §4 Pillar B, Monthly review, Quarterly review session",
    specs: ["reviews.spec.ts"],
  },
  {
    flow: "Change an OKR mid-cycle",
    requirement: "REQUIREMENTS §4 Pillar B, Mid-cycle changes",
    specs: ["s13h-mid-cycle.spec.ts", "s13i-stop.spec.ts"],
  },
  {
    flow: "Close a cycle",
    requirement: "REQUIREMENTS §4 Pillar A, Cycles and the planning workflow",
    specs: ["s04-cycle-closing.spec.ts"],
  },
  {
    flow: "Work the review inbox",
    requirement: "REQUIREMENTS §4 Pillar B, Review inbox and digests",
    specs: ["s03-inbox.spec.ts"],
  },
  {
    flow: "Plan the work: initiatives, tasks on the board, and documents",
    requirement:
      "REQUIREMENTS §4 Pillar C, Initiatives, Tasks and the OKR board, Documents",
    specs: [
      "s26-initiatives.spec.ts",
      "s27-board.spec.ts",
      "s29-documents.spec.ts",
    ],
  },
  {
    flow: "The Coach and the Champion run, with AI off",
    requirement: "REQUIREMENTS §4 Pillar D, The OKR Coach and OKR Champion agents",
    specs: ["ai-off.spec.ts", "s36m-agent-runs.spec.ts"],
  },
  {
    flow: "Ask the copilot, which searches with AI off",
    requirement: "REQUIREMENTS §4 Pillar D, Copilot",
    specs: ["s39-copilot.spec.ts"],
  },
  {
    flow: "Connect an external agent",
    requirement: "REQUIREMENTS §4 Pillar D, MCP server",
    specs: ["s40b-oauth-consent.spec.ts", "s41-mcp-transport.spec.ts"],
  },
  {
    flow: "Route notifications to a channel",
    requirement: "REQUIREMENTS §4 Pillar E, Channels and reach",
    specs: ["s36-channels.spec.ts"],
  },
  {
    flow: "Invite people, and see the product as an ordinary member",
    requirement: "REQUIREMENTS §4 Pillar F, People and org, Access",
    specs: [
      "s33-people.spec.ts",
      "s35-join.spec.ts",
      "s42b-ordinary-member.spec.ts",
    ],
  },
  {
    flow: "Search and jump",
    requirement: "REQUIREMENTS §4 Pillar F, Search and command palette",
    specs: ["s32-search.spec.ts"],
  },
  {
    flow: "Administer: the audit trail, an import and an archive",
    requirement: "REQUIREMENTS §4 Pillar F, Admin",
    specs: [
      "s36h-audit-trail.spec.ts",
      "s36b-import-wizard.spec.ts",
      "s36j-workspace-archive.spec.ts",
    ],
  },
];

/** Every spec file a P0 flow names, once each, in the order listed. */
export function p0SpecFiles(): string[] {
  return [...new Set(P0_FLOWS.flatMap((flow) => flow.specs))];
}

// Run as a script, it prints the files as Playwright filters, so a step can
// name the P0 flows without a list of its own.
if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(p0SpecFiles().map((file) => `e2e/${file}`).join(" "));
}
