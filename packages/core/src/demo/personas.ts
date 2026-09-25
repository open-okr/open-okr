/**
 * Turning a seeded demo workspace into one a visitor can walk around (P8-T13a).
 *
 * P3-T17 built the story and said plainly what it could not do: "demo people
 * cannot sign in. They are members with no user account." That was right for
 * a seed somebody runs on their own laptop before a presentation, where the
 * presenter is signed in and the cast are names on a screen. It is wrong for a
 * public demo instance, where the visitor is nobody and the only way to see
 * the product as Priya sees it is to be Priya.
 *
 * So this gives each of the seven invented people an account, attaches it to
 * the member row the builder already wrote, puts both agents in sandbox, and
 * runs the Coach and the Champion once.
 *
 * **What it refuses to do, and why:**
 *
 * - **It refuses a workspace the demo builder did not build.** The test is the
 *   builder's own: company objectives from the cast. Giving a real
 *   organisation's members invented accounts with a published password is the
 *   one mistake this command could make that matters, so the guard is on the
 *   command rather than in the documentation.
 * - **It never touches a member who already has somebody behind them.** A
 *   member with a `user_id` is a real person, whatever their name looks like.
 * - **The password is published, and that is the point.** A demo account
 *   nobody can sign into is not a demo account. It is stated here, in the
 *   documentation and on the sign-in page, so nobody mistakes it for a secret
 *   that leaked.
 * - **The agents go to sandbox, not to propose.** AI-NATIVE-PLAN's sandbox
 *   commits nothing at all, which is what a public instance strangers can
 *   press buttons on needs. A visitor still sees the runs, the nudges and the
 *   review queue, because those are recorded either way.
 */
import { activeOnly, withWorkspace, workspaceMembers } from "@openokr/db";
import { eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { callAction } from "../actions/registry.ts";
import type { createAuth } from "../auth/auth.ts";
import { withProvisioningAuthority } from "../auth/provisioning-authority.ts";
import { OperationError } from "../operations/errors.ts";
import { runOperation } from "../operations/operation.ts";
import { INVENTED_CAST } from "./cast.ts";

type Auth = ReturnType<typeof createAuth>;

/**
 * The password every persona shares on a demo instance.
 *
 * Not a secret. A demo instance is public by definition and the whole point of
 * these accounts is that a stranger can use them, so the value is here, in the
 * documentation, and on the page that offers them.
 */
export const DEMO_PERSONA_PASSWORD = "explore-openokr";

/** One persona a visitor may sign in as, for the sign-in page (P8-T13c). */
export interface DemoPersona {
  readonly name: string;
  readonly email: string;
  readonly title: string;
}

/**
 * Who a visitor can be on a demo instance.
 *
 * The same seven the seed writes and `demo:prepare` gives accounts to, in the
 * cast's own order so the list reads top-down through the organisation. The
 * page that shows this cannot ask the database who has an account, because it
 * is rendered before anybody is signed in.
 */
export const DEMO_PERSONAS: readonly DemoPersona[] = INVENTED_CAST.map(
  (person) => ({
    name: person.name,
    email: person.email,
    title: person.title,
  }),
);

export interface PrepareDemoPersonasInput {
  readonly pool: Pool;
  readonly workspaceId: string;
  /** The person every write is authorised and attributed as. */
  readonly adminUserId: string;
  /**
   * The Better Auth instance, injected by whoever has one.
   *
   * Accounts are created through it rather than beside it, so a persona's
   * account is the same shape as one born from a sign-up and stays that way
   * when Better Auth adds a column.
   */
  readonly auth: Auth;
  /** Overridable, so an operator can run a demo nobody else can sign into. */
  readonly password?: string;
}

/** One persona, after the command has been through them. */
export interface PreparedPersona {
  readonly name: string;
  readonly email: string;
  readonly title: string;
  /** Whether this run is what gave them an account. */
  readonly created: boolean;
}

export interface PrepareDemoPersonasResult {
  readonly personas: readonly PreparedPersona[];
  readonly accountsCreated: number;
  readonly agentsSandboxed: number;
  /** Nudges the Coach's run recorded, which is what a visitor sees first. */
  readonly coachNudges: number;
  readonly championNudges: number;
  /** Rule keys the Coach fired, so the command can print them. */
  readonly ruleKeys: readonly string[];
  /** Anything skipped, in words an operator can act on. */
  readonly notes: readonly string[];
}

type Context = {
  pool: Pool;
  workspaceId: string;
  actor: { kind: "human"; userId: string };
};

/**
 * Prepares the workspace, or refuses it.
 *
 * Idempotent in every part: an account that exists is reused, an agent already
 * in sandbox is set to sandbox again, and the two runs deduplicate their own
 * nudges the way they do on any other day.
 */
export async function prepareDemoPersonas(
  input: PrepareDemoPersonasInput,
): Promise<PrepareDemoPersonasResult> {
  const context: Context = {
    pool: input.pool,
    workspaceId: input.workspaceId,
    actor: { kind: "human", userId: input.adminUserId },
  };

  await refuseUnlessSeeded(context);

  const notes: string[] = [];
  const personas: PreparedPersona[] = [];
  let accountsCreated = 0;

  for (const person of INVENTED_CAST) {
    const member = await memberByName(
      input.pool,
      input.workspaceId,
      person.name,
    );
    if (!member) {
      notes.push(
        `${person.name} is not a member of this workspace. The demo seed writes them, so this workspace was seeded by an older version.`,
      );
      continue;
    }
    if (member.userId) {
      // Somebody is already behind this row. It may be a persona from an
      // earlier run or it may be a real person who happens to share the name;
      // either way this command has nothing to add and no right to overwrite.
      personas.push({
        name: person.name,
        email: person.email,
        title: person.title,
        created: false,
      });
      continue;
    }

    const userId = await accountFor(input, person.name, person.email);
    await attachAccount(input, member.id, userId, person.name);
    accountsCreated += 1;
    personas.push({
      name: person.name,
      email: person.email,
      title: person.title,
      created: true,
    });
  }

  const agentsSandboxed = await sandboxEveryAgent(context);
  const { coachNudges, championNudges, ruleKeys } =
    await runBothAgents(context);

  return {
    personas,
    accountsCreated,
    agentsSandboxed,
    coachNudges,
    championNudges,
    ruleKeys,
    notes,
  };
}

/**
 * The guard.
 *
 * The same test the builder uses for its own idempotence, read the other way
 * round: company objectives are what the demo builder always writes and what
 * nothing else creates on a fresh workspace, so their absence means this
 * workspace is not a demo and must not be given invented accounts.
 */
async function refuseUnlessSeeded(context: Context): Promise<void> {
  const existing = await callAction(context, "goals.list", {
    includeClosed: true,
    level: "company",
  });
  if (existing.goals.length === 0) {
    throw new OperationError(
      "not_found",
      "This workspace holds no demo content. Run `pnpm db:seed` first. Personas are only ever given to a workspace the demo builder built.",
    );
  }
}

/**
 * The member with this name, and whoever is behind them.
 *
 * Inside the tenant setting, because `workspace_members` is behind the tenant
 * floor and the application role is `nobypassrls`: a bare pool query would
 * return no rows and this command would report every persona missing.
 */
async function memberByName(
  pool: Pool,
  workspaceId: string,
  name: string,
): Promise<{ id: string; userId: string | null } | null> {
  const db = drizzle(pool);
  return withWorkspace(db, workspaceId, async (tx) => {
    const [row] = await tx
      .select({ id: workspaceMembers.id, userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        activeOnly(
          workspaceMembers,
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.name, name),
        ),
      )
      .orderBy(workspaceMembers.createdAt)
      .limit(1);
    return row ?? null;
  });
}

/** The account with this address, or null. Better Auth owns the table. */
async function userIdByEmail(
  pool: Pool,
  email: string,
): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    "select id from users where email = $1",
    [email.toLowerCase()],
  );
  return rows[0]?.id ?? null;
}

/**
 * The persona's account, created through Better Auth or found.
 *
 * Two steps because a credential account is two rows: the user, and the
 * password hanging off it. Better Auth's own reset path writes them in exactly
 * this order and this is the same pair of calls, so a persona's account is
 * indistinguishable from one somebody set a password on themselves.
 */
export async function accountFor(
  input: PrepareDemoPersonasInput,
  name: string,
  email: string,
): Promise<string> {
  const existing = await userIdByEmail(input.pool, email);
  const authContext = await input.auth.$context;

  const userId =
    existing ??
    (
      await withProvisioningAuthority(
        { kind: "demo", workspaceId: input.workspaceId },
        () =>
          authContext.internalAdapter.createUser<{ id: string }>(
            {
              email: email.toLowerCase(),
              name,
              // Nobody is going to click a link in a mailbox that does not
              // exist, and a demo persona who cannot sign in is not a persona.
              emailVerified: true,
            },
            { method: "demo" },
          ),
      )
    ).id;

  const password = input.password ?? DEMO_PERSONA_PASSWORD;
  const hashed = await authContext.password.hash(password);
  const credential =
    await authContext.internalAdapter.findCredentialAccount(userId);
  if (credential) {
    await authContext.internalAdapter.updatePassword(userId, hashed);
  } else {
    await authContext.internalAdapter.createAccount({
      userId,
      providerId: "credential",
      accountId: userId,
      password: hashed,
    });
  }

  return userId;
}

/**
 * Points the member row at the account.
 *
 * Through the Operation pipeline rather than a bare update, so the change
 * carries an activity row and an audit row like every other write. There is no
 * action for this because there is no product path to it: a member gets a
 * `user_id` by accepting an invitation, and a demo persona has no mailbox to
 * accept one in.
 */
async function attachAccount(
  input: PrepareDemoPersonasInput,
  memberId: string,
  userId: string,
  name: string,
): Promise<void> {
  await runOperation(
    { pool: input.pool },
    {
      action: "demo.attachPersona",
      workspaceId: input.workspaceId,
      actor: { kind: "human", userId: input.adminUserId },
      async execute({ tx, workspaceId }) {
        // openokr:allow-mutation: this is the operation's own execute, on the
        // transaction runOperation opened. The change, the activity and the
        // audit row commit together.
        await tx
          .update(workspaceMembers)
          .set({ userId, updatedAt: new Date() })
          .where(
            activeOnly(
              workspaceMembers,
              eq(workspaceMembers.id, memberId),
              eq(workspaceMembers.workspaceId, workspaceId),
              // Only ever a member with nobody behind them. Two runs racing
              // would otherwise let the second overwrite the first.
              isNull(workspaceMembers.userId),
            ),
          );
        return {
          result: memberId,
          activity: {
            kind: "member.updated" as const,
            subjectType: "member" as const,
            subjectId: memberId,
            payload: { name },
          },
          audit: {
            action: "demo.attachPersona",
            targetType: "member",
            targetId: memberId,
            payload: { name },
          },
        };
      },
    },
  );
}

/**
 * Both agent members to sandbox.
 *
 * Sandbox commits nothing at all, which is the only autonomy a public instance
 * strangers can press buttons on should run. The runs, the nudges and the
 * review queue are all still recorded, so what a visitor sees is the product
 * working rather than the product switched off.
 */
async function sandboxEveryAgent(context: Context): Promise<number> {
  const agents = await callAction(context, "agents.list", {});
  let changed = 0;
  for (const agent of agents) {
    await callAction(context, "agents.setAutonomy", {
      id: agent.id,
      autonomy: "sandbox",
    });
    changed += 1;
  }
  return changed;
}

/**
 * One run each, so the nudges on screen are ones the product produced.
 *
 * A demo that inserted a coaching message would be showing a row rather than a
 * rule. These two runs fire the real triggers against the seeded quarter, and
 * every message they write carries the rule key that resolves back to
 * METHOD.md.
 */
async function runBothAgents(context: Context): Promise<{
  coachNudges: number;
  championNudges: number;
  ruleKeys: readonly string[];
}> {
  const coach = await callAction(context, "agents.runCoach", {});
  const champion = await callAction(context, "agents.runChampion", {
    cadence: "daily",
  });
  return {
    coachNudges: coach.recorded,
    championNudges: champion.recorded,
    ruleKeys: coach.ruleKeys,
  };
}
