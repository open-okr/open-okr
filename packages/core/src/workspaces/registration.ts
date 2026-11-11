/**
 * The registration policy (TECHNICAL-PLAN §4.14, instance scope).
 *
 * "Open until the first admin exists, then invitation-only." There is no admin
 * role yet, because roles are access bindings and those arrive with P2-T01. So
 * the question is asked the way the plan means it: an instance nobody has
 * claimed is open, and a claimed one is closed.
 *
 * The count is over `users`, not `workspaces`. `users` is global and carries no
 * row-level security, so it answers truthfully; a count over `workspaces` runs
 * under the tenant floor and would report zero on every unscoped connection,
 * which would leave registration open forever.
 *
 * P1-T09 added the stored override this file anticipated. `registration.policy`
 * holds 'auto', 'open' or 'invite_only'. 'auto' is the default and is the
 * computed answer above; the other two fix the policy whatever the instance
 * looks like, which is what an operator running a public instance or a closed
 * one actually wants.
 */
import { systemSettings } from "@openokr/db";
import { isFreeMailAddress } from "@openokr/formats";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { recordInstanceAuditEvent } from "../audit/instance-chain.ts";
import { inviteTokenFromCookies } from "../invitations/pending.ts";
import { addressMayAccept, previewInvite } from "../invitations/preview.ts";
import { OperationError } from "../operations/errors.ts";
import { isLiveOperator } from "../operator/store.ts";
import {
  environmentValue,
  getInstanceSetting,
} from "../secrets/instance-registry.ts";
import {
  readSetting,
  resolveSetting,
  type SettingSource,
  writeSettings,
} from "../secrets/instance-settings.ts";
import type { KeyRing } from "../secrets/key-ring.ts";
import { isCloudEnabled } from "../tenancy/index.ts";

const POLICY_KEY = "registration.policy";

type Environment = Record<string, string | undefined>;

/**
 * The three answers an administrator chooses between (docs/design/
 * registration-policy.md §2, D2). `auto` is stored by older instances and
 * read as one of these; it is never offered.
 */
export const REGISTRATION_POLICIES = [
  "invite_only",
  "company_domains",
  "open",
] as const;

export type RegistrationPolicy = (typeof REGISTRATION_POLICIES)[number];

const isPolicy = (value: unknown): value is RegistrationPolicy =>
  (REGISTRATION_POLICIES as readonly unknown[]).includes(value);

/** The computed half: an instance nobody has claimed is open. */
async function isUnclaimed(pool: Pool): Promise<boolean> {
  const result = await pool.query("select 1 from users limit 1");
  return result.rowCount === 0;
}

/**
 * The policy in force and where it came from: a value saved in the
 * application, then `OPENOKR_REGISTRATION`, then the default (D7).
 *
 * `auto`, an unset value and anything unrecognised read as the computed
 * answer: open while nobody has claimed the instance, invitation only once
 * somebody has. A typo in a settings row must not take the sign-in page down.
 */
export async function readRegistrationPolicy(
  pool: Pool,
  environment: Environment = process.env,
): Promise<{
  readonly value: RegistrationPolicy;
  readonly source: SettingSource;
}> {
  const definition = getInstanceSetting(POLICY_KEY);
  const stored = await readSetting(pool, POLICY_KEY);
  const fromVariable = definition
    ? environmentValue(definition, environment)
    : undefined;
  const resolved = resolveSetting<unknown>(
    isPolicy(stored) ? stored : undefined,
    isPolicy(fromVariable) ? fromVariable : undefined,
    "auto",
  );
  if (isPolicy(resolved.value)) {
    return { value: resolved.value, source: resolved.source };
  }
  return {
    value: (await isUnclaimed(pool)) ? "open" : "invite_only",
    source: "default",
  };
}

/**
 * The policy a sign-up meets.
 *
 * **A cloud instance with no policy chosen is open however many people have
 * claimed it**
 * (P8-T02b), and the registration card is not shown there (D5). The computed
 * answer exists because a self-hosted instance belongs to whoever set it up,
 * so the first registration closing the door behind itself is right. A cloud
 * belongs to nobody, and the same rule there would mean exactly one customer
 * ever signed up.
 *
 * This reads the instance's own flag, not a tenant row, which is why it is
 * allowed on a product path at all: `cloud.enabled` is a fact about the
 * deployment, and `tenants` is vendor knowledge about a customer. The
 * boundary gate draws the line in the same place.
 */
async function policyInForce(
  pool: Pool,
  environment: Environment,
): Promise<RegistrationPolicy> {
  const read = await readRegistrationPolicy(pool, environment);
  // A policy somebody chose wins on a cloud too: an operator may close one.
  if (read.source !== "default") {
    return read.value;
  }
  return (await isCloudEnabled(pool)) ? "open" : read.value;
}

/**
 * Whether the address rule refuses this address (docs/design/
 * account-self-service.md AS-Q2 (a)): only company email addresses are
 * accepted, and this is a free mail address.
 *
 * **The address rule only**, without the invitation rule. Moving an existing
 * account's sign-in email (plan 0.8.0 Y4) is not a registration, so
 * `invite_only`, which decides who may create an account, refuses nothing
 * here. `company_domains` is a rule about addresses, so it holds for a moved
 * address as it does for a new one.
 */
export async function addressRuleRefuses(
  pool: Pool,
  email: string,
  environment: Environment = process.env,
): Promise<boolean> {
  if (!isFreeMailAddress(email)) {
    return false;
  }
  return (await policyInForce(pool, environment)) === "company_domains";
}

/** Whether anybody at all may register, whatever their address. */
export async function isRegistrationOpen(
  pool: Pool,
  environment: Environment = process.env,
): Promise<boolean> {
  return (await policyInForce(pool, environment)) === "open";
}

export type RegistrationChange = "changed" | "unchanged";

/**
 * Saves the policy an administrator chose on General (D1, D4, D6).
 *
 * The caller checks the member's level and that this is not a cloud; this
 * writes the row and the instance audit event, like `renameInstance`.
 */
export async function setRegistrationPolicy(
  pool: Pool,
  ring: KeyRing,
  input: {
    readonly policy: RegistrationPolicy;
    readonly userId: string;
    readonly workspaceId: string;
  },
  environment: Environment = process.env,
): Promise<RegistrationChange> {
  const current = await readRegistrationPolicy(pool, environment);
  // Already in force, wherever it came from: saving it would only pin a value
  // from the variable or the default that nobody changed.
  if (current.value === input.policy) {
    return "unchanged";
  }
  await writeSettings(pool, ring, [
    { key: POLICY_KEY, value: input.policy, source: "admin" },
  ]);
  await recordInstanceAuditEvent(pool, {
    action: "instance.registration_changed",
    payload: {
      from: current.value,
      to: input.policy,
      userId: input.userId,
      workspaceId: input.workspaceId,
    },
  });
  return "changed";
}

/**
 * Saves the policy a cloud operator chose on S-47 (registration-policy.md §9
 * D12 to D15, plan 0.7.0 B1).
 *
 * On a cloud the policy is the operator's and no workspace screen offers it,
 * so this is the only door short of the database. The grant is checked here,
 * the row is saved with source `operator` so the card can say who chose it,
 * and the change is recorded on the instance chain only: the policy belongs
 * to no workspace. Compared against the policy in force, which on a cloud
 * with nothing stored is open, rather than against the computed default.
 */
export async function setRegistrationPolicyAsOperator(
  pool: Pool,
  ring: KeyRing,
  input: {
    readonly policy: RegistrationPolicy;
    readonly operatorUserId: string;
  },
  environment: Environment = process.env,
): Promise<RegistrationChange> {
  if (!(await isLiveOperator(pool, input.operatorUserId))) {
    throw new OperationError("not_found", "No such setting.");
  }
  const inForce = await policyInForce(pool, environment);
  if (inForce === input.policy) {
    return "unchanged";
  }
  await writeSettings(pool, ring, [
    { key: POLICY_KEY, value: input.policy, source: "operator" },
  ]);
  await recordInstanceAuditEvent(pool, {
    action: "instance.registration_changed",
    payload: {
      from: inForce,
      to: input.policy,
      operatorUserId: input.operatorUserId,
    },
  });
  return "changed";
}

/** Who chose the policy in force, for the S-47 card's source line (§9.3). */
export type RegistrationOrigin =
  | "operator"
  | "admin"
  | "wizard"
  | "environment"
  | "default";

export async function registrationPolicyOrigin(
  pool: Pool,
  environment: Environment = process.env,
): Promise<RegistrationOrigin> {
  const read = await readRegistrationPolicy(pool, environment);
  if (read.source !== "database") {
    return read.source;
  }
  const [row] = await drizzle(pool)
    .select({ source: systemSettings.source })
    .from(systemSettings)
    .where(eq(systemSettings.key, POLICY_KEY))
    .limit(1);
  // A row the wizard saved before 0.7.0 is kept (§9 D16, Akmal's Q2 answer),
  // and the card says so, which is how an operator finds it.
  return row?.source === "operator" || row?.source === "wizard"
    ? row.source
    : "admin";
}

/**
 * What a refused registration says. It names the way in rather than only the
 * way out, because somebody hitting this is usually a colleague who was told
 * to sign up (screen S-35).
 */
export const REGISTRATION_CLOSED_MESSAGE =
  "This instance is invitation-only. Ask a workspace admin to invite you.";

/**
 * What a free mail address meets when registration is open to company
 * addresses only. It names the way in, as the closed message does.
 */
export const COMPANY_EMAIL_MESSAGE =
  "Use your company email address to start a workspace. A Gmail, Yahoo, Outlook or other free mail address needs an invitation from a workspace admin.";

/**
 * Whether this request may register, invitation included (P6-G06b).
 *
 * **The hook and the page have to agree, and they did not.** P1-T06 refuses
 * user creation inside Better Auth's own `user.create.before`, deliberately,
 * so no future sign-in path can reopen registration by not knowing the rule.
 * P6-G06b taught that hook about invitations and left the sign-up page asking
 * the narrower question, so a closed instance showed an invitee "Registration
 * is closed" and never rendered a form the hook would have accepted. The
 * invitation was redeemable and unreachable at the same time.
 *
 * Found by the end-to-end spec, which pressed the button and waited for a name
 * field that was never going to appear.
 *
 * One function, both callers. The cookie is the same one `/join` sets, and a
 * token that is not usable is the same as no token at all.
 *
 * **`email` is optional because one caller has one and the other never can.**
 * The sign-up page asks before anybody has typed an address, to decide
 * whether to render the form at all, so it asks the token-only question: is
 * there something here worth a form. Better Auth's own `user.create.before`
 * asks after the address exists, and that is the call that actually admits
 * somebody, so it is the one required to pass it.
 *
 * **Without it, a token for one address opened registration for any address**
 * (manual UAT, 29 September 2026, M04-03). `registrationOpenOrInvited`
 * checked only whether *some* usable token sat in the cookie, never which
 * email the token was for, so a personal invitation for `a@x` let a visitor
 * register `b@x` instead: the `before` hook let it through, and `after`'s
 * `acceptPendingInvitation` then refused to join a workspace it was never
 * addressed to, silently, and the account fell through to its own fresh
 * workspace. A single-use invitation for one address had become a skeleton
 * key for a closed instance. `addressMayAccept`, the function
 * `invitations.acceptLink` already uses for the identical decision, closes
 * that gap here too rather than a third copy of the same rule.
 */
export async function registrationOpenOrInvited(
  pool: Pool,
  cookieHeader: string | null,
  email?: string,
  environment: Environment = process.env,
): Promise<boolean> {
  return (
    (await registrationRefusal(pool, cookieHeader, email, environment)) === null
  );
}

/**
 * Why this request may not register, or null when it may (docs/design/
 * registration-policy.md §3).
 *
 * Under company email addresses a free mail address is refused unless an
 * invitation admits it. With no address yet, which is the sign-up page
 * deciding whether to draw its form, a company-only instance is open: the
 * address is judged when it arrives, in the same hook as every other rule.
 */
export async function registrationRefusal(
  pool: Pool,
  cookieHeader: string | null,
  email?: string,
  environment: Environment = process.env,
): Promise<string | null> {
  const policy = await policyInForce(pool, environment);
  if (policy === "open") {
    return null;
  }
  if (
    policy === "company_domains" &&
    (email === undefined || !isFreeMailAddress(email))
  ) {
    return null;
  }
  const token = inviteTokenFromCookies(cookieHeader);
  if (token) {
    const invitation = await previewInvite(pool, { token, now: new Date() });
    if (
      invitation.kind === "usable" &&
      (email === undefined || addressMayAccept(invitation, email))
    ) {
      return null;
    }
  }
  return policy === "company_domains"
    ? COMPANY_EMAIL_MESSAGE
    : REGISTRATION_CLOSED_MESSAGE;
}
