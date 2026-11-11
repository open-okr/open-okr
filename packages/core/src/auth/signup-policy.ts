/**
 * Whether a sign-in must wait for a verified address (P8-T02b).
 *
 * **The question is not "is this a cloud", it is "can a link arrive".**
 * `requireEmailVerification` has been false since P1-T05 with a reason
 * written beside it: a self-hosted first run has no mail server, and
 * blocking the first login on an email nobody can receive makes the product
 * unusable out of the box. That reason stops applying the moment the
 * instance has a real transport, and it stops applying whether the instance
 * is a managed cloud or somebody's own server.
 *
 * Agung chose this over tying it to `cloud.enabled` on 14 September 2026. It
 * is the better rule for the same effort: a self-hosted instance with SMTP
 * gets verification too, and nobody has to remember that the cloud flag also
 * means this.
 *
 * **Resolved once, at boot.** Better Auth reads
 * `emailAndPassword.requireEmailVerification` off an options object built
 * once per process, and `getAuth()` is synchronous. So the web app resolves
 * this during `register()` and hands the answer in. Changing `mail.transport`
 * therefore needs a restart before sign-in behaviour follows, which is worth
 * knowing and is the price of not making `getAuth()` async.
 *
 * The safe direction is off. A process that somehow asks before the boot
 * step ran behaves as every instance did before this existed, rather than
 * locking everybody out.
 */
import type { Pool } from "pg";
import { recordInstanceAuditEvent } from "../audit/instance-chain.ts";
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
import { isCloudEnabled } from "../tenancy/settings.ts";
import { readRegistrationPolicy } from "../workspaces/registration.ts";

const MAIL_TRANSPORT_KEY = "mail.transport";

/** The transport that writes to the log instead of sending. */
const CONSOLE_TRANSPORT = "console";

/** The transports that genuinely deliver. */
const DELIVERING_TRANSPORTS: readonly string[] = ["smtp"];

export async function resolveRequireEmailVerification(
  pool: Pool,
): Promise<boolean> {
  const definition = getInstanceSetting(MAIL_TRANSPORT_KEY);
  if (!definition) {
    return false;
  }
  const stored = await readSetting(pool, MAIL_TRANSPORT_KEY);
  const environment = environmentValue(definition, process.env);
  const transport = resolveSetting(stored, environment, definition.fallback)
    .value as string;

  // An unrecognised transport is deliberately not treated as delivering.
  // P7-T08d made a typo refuse and name the setting rather than silently
  // become `console`; whatever that refusal does, it must not be reached by
  // locking every member out of sign-in first.
  if (transport === CONSOLE_TRANSPORT) {
    return false;
  }
  return DELIVERING_TRANSPORTS.includes(transport);
}

/**
 * Whether confirmation at sign-up may be turned off (plan 0.8.0 S4,
 * docs/design/email-verification.md §11).
 *
 * `auto` is the rule above: required exactly when a link can arrive. `off`
 * lets an organisation that wants people in without a mail round trip say
 * so. It lowers nothing but the sign-in wait: joining a workspace by
 * trusted domain still asks for a confirmed address, and under the
 * `company_domains` registration policy confirmation stays required
 * whatever this says (Q13), because that policy trusts the domain.
 */
const EMAIL_VERIFICATION_KEY = "auth.emailVerification";

export const EMAIL_VERIFICATION_MODES = ["auto", "off"] as const;
export type EmailVerificationMode = (typeof EMAIL_VERIFICATION_MODES)[number];

const isMode = (value: unknown): value is EmailVerificationMode =>
  typeof value === "string" &&
  (EMAIL_VERIFICATION_MODES as readonly string[]).includes(value);

type Environment = Record<string, string | undefined>;

export async function readEmailVerificationMode(
  pool: Pool,
  environment: Environment = process.env,
): Promise<{
  readonly value: EmailVerificationMode;
  readonly source: SettingSource;
}> {
  const definition = getInstanceSetting(EMAIL_VERIFICATION_KEY);
  const stored = await readSetting(pool, EMAIL_VERIFICATION_KEY);
  const fromVariable = definition
    ? environmentValue(definition, environment)
    : undefined;
  const resolved = resolveSetting<unknown>(
    isMode(stored) ? stored : undefined,
    isMode(fromVariable) ? fromVariable : undefined,
    "auto",
  );
  return {
    value: isMode(resolved.value) ? resolved.value : "auto",
    source: resolved.source,
  };
}

export interface EmailConfirmation {
  /** A sign-in waits for a confirmed address. */
  readonly required: boolean;
  /** The instance can deliver a link at all. */
  readonly linksCanArrive: boolean;
  readonly mode: EmailVerificationMode;
  /** `off` was chosen, and `company_domains` keeps it required (Q13). */
  readonly heldByCompanyDomains: boolean;
  /** Registration is limited to company domains, so `off` is not offered. */
  readonly companyDomains: boolean;
}

/**
 * The one answer every reader takes: Better Auth's sign-in wait, the link
 * on sign-up, and the cards that show the setting.
 */
export async function resolveEmailConfirmation(
  pool: Pool,
  environment: Environment = process.env,
): Promise<EmailConfirmation> {
  const [linksCanArrive, mode, policy] = await Promise.all([
    resolveRequireEmailVerification(pool),
    readEmailVerificationMode(pool, environment),
    readRegistrationPolicy(pool, environment),
  ]);
  const companyDomains = policy.value === "company_domains";
  const heldByCompanyDomains = mode.value === "off" && companyDomains;
  return {
    companyDomains,
    required: linksCanArrive && (mode.value === "auto" || heldByCompanyDomains),
    linksCanArrive,
    mode: mode.value,
    heldByCompanyDomains,
  };
}

/** Said when `off` is chosen under `company_domains` (Q13). */
export const HELD_BY_COMPANY_DOMAINS =
  "Registration is limited to your company's domains, which needs a confirmed address.";

async function writeMode(
  pool: Pool,
  ring: KeyRing,
  input: {
    readonly mode: EmailVerificationMode;
    readonly source: "admin" | "operator";
    readonly by: Readonly<Record<string, string>>;
  },
  environment: Environment,
): Promise<"changed" | "unchanged"> {
  const current = await readEmailVerificationMode(pool, environment);
  if (input.mode === "off") {
    const policy = await readRegistrationPolicy(pool, environment);
    if (policy.value === "company_domains") {
      throw new OperationError("conflict", HELD_BY_COMPANY_DOMAINS);
    }
  }
  if (current.value === input.mode && current.source === "database") {
    return "unchanged";
  }
  await writeSettings(pool, ring, [
    { key: EMAIL_VERIFICATION_KEY, value: input.mode, source: input.source },
  ]);
  if (current.value === input.mode) {
    // Pinned where it was only a default or the environment: not a change
    // anybody would read in the trail.
    return "unchanged";
  }
  await recordInstanceAuditEvent(pool, {
    action: "instance.email_verification_set",
    payload: { from: current.value, to: input.mode, ...input.by },
  });
  return "changed";
}

/**
 * An administrator's change, on Admin, General. A self-hosted or group
 * instance only: on a cloud the accounts are shared by every customer, so it
 * is the operator's (Q12). The caller has checked the administrator's level.
 */
export async function setEmailVerificationMode(
  pool: Pool,
  ring: KeyRing,
  input: {
    readonly mode: EmailVerificationMode;
    readonly userId: string;
    readonly workspaceId: string;
  },
  environment: Environment = process.env,
): Promise<"changed" | "unchanged"> {
  if (await isCloudEnabled(pool)) {
    throw new OperationError(
      "forbidden",
      "On this instance the operator decides whether a new account confirms its email.",
    );
  }
  return writeMode(
    pool,
    ring,
    {
      mode: input.mode,
      source: "admin",
      by: { userId: input.userId, workspaceId: input.workspaceId },
    },
    environment,
  );
}

/** The operator's change, on the console's Instance screen (Q12). */
export async function setEmailVerificationModeAsOperator(
  pool: Pool,
  ring: KeyRing,
  input: {
    readonly mode: EmailVerificationMode;
    readonly operatorUserId: string;
  },
  environment: Environment = process.env,
): Promise<"changed" | "unchanged"> {
  if (!(await isLiveOperator(pool, input.operatorUserId))) {
    throw new OperationError("not_found", "No such setting.");
  }
  return writeMode(
    pool,
    ring,
    {
      mode: input.mode,
      source: "operator",
      by: { operatorUserId: input.operatorUserId },
    },
    environment,
  );
}
