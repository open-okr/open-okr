/**
 * What this instance calls itself (completeness review M-33).
 *
 * `instance.name` was declared in the registry, bootstrapped from
 * `OPENOKR_INSTANCE_NAME`, written by the wizard, and read by nothing. Every
 * screen, email and chat message said "OpenOKR" whatever the operator had
 * chosen, and the public demo shipped with "OpenOKR demo" in its environment
 * and "OpenOKR" on every page.
 *
 * **One reader.** The page title, the sign-in heading, the setup heading, the
 * nudges, the invitation, the password reset, the two-factor issuer and the
 * rest all ask `resolveInstanceName`, in the order every instance setting
 * resolves: the stored value, then the environment, then "OpenOKR".
 *
 * **Never fatal where it is read.** A name is display text. An instance that
 * cannot read `system_settings` for a moment still has the name its
 * deployment gave it, and a page title is no reason to fail a request.
 *
 * **The outbox relay and the scheduler resolve it when they send**, because
 * neither has a request to read it from, and a rename at three in the
 * afternoon should reach the four o'clock nudge. The builders themselves take
 * the name as a value, the same way they take the instance's address.
 */
import type { Pool } from "pg";
import { recordInstanceAuditEvent } from "../audit/instance-chain.ts";
import {
  DEFAULT_INSTANCE_NAME,
  environmentValue,
  getInstanceSetting,
  type InstanceSettingDefinition,
} from "./instance-registry.ts";
import {
  clearSetting,
  readSetting,
  resolveSetting,
  type SettingSource,
  writeSettings,
} from "./instance-settings.ts";
import type { KeyRing } from "./key-ring.ts";

const INSTANCE_NAME_KEY = "instance.name";

/** The longest name the wizard and the admin screen accept. */
export const INSTANCE_NAME_MAX_LENGTH = 120;

type Environment = Record<string, string | undefined>;

const definition = (): InstanceSettingDefinition => {
  const found = getInstanceSetting(INSTANCE_NAME_KEY);
  if (!found) {
    // Impossible unless the registry loses the key, and that should fail
    // every test loudly rather than quietly name everything "OpenOKR".
    throw new Error(
      `${INSTANCE_NAME_KEY} is not declared in the instance registry`,
    );
  }
  return found;
};

/** A name somebody could read, or undefined for blank and non-text values. */
const usable = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

/**
 * The name when nothing is stored: the environment, then "OpenOKR".
 *
 * What the deployment says, and what a cleared admin field goes back to.
 */
export function deploymentInstanceName(
  environment: Environment = process.env,
): string {
  return (
    usable(environmentValue(definition(), environment)) ?? DEFAULT_INSTANCE_NAME
  );
}

/**
 * The resolved name and where it came from. Throws when the database does.
 *
 * The admin screen needs the source, to say whether the name on it is the
 * deployment's or one somebody saved there.
 */
export async function readInstanceName(
  pool: Pool,
  environment: Environment = process.env,
): Promise<{ readonly value: string; readonly source: SettingSource }> {
  const stored = usable(await readSetting(pool, INSTANCE_NAME_KEY));
  return resolveSetting(
    stored,
    usable(environmentValue(definition(), environment)),
    DEFAULT_INSTANCE_NAME,
  );
}

/** The resolved name. Never throws: see the file comment. */
export async function resolveInstanceName(
  pool: Pool,
  environment: Environment = process.env,
): Promise<string> {
  try {
    return (await readInstanceName(pool, environment)).value;
  } catch {
    return deploymentInstanceName(environment);
  }
}

/**
 * What the wizard should store for the name field, or null for nothing.
 *
 * **Nothing, when the field was left as it was pre-filled.** The wizard
 * pre-fills the resolved name, which before setup is the environment's. It
 * used to store whatever the field held, and a stored value beats the
 * environment, so an operator who set `OPENOKR_INSTANCE_NAME` and clicked
 * through the wizard had copied it into the database, where changing the
 * variable afterwards did nothing. An empty field stores nothing too.
 */
export function instanceNameToStore(
  submitted: string,
  prefilled: string,
): string | null {
  const name = submitted.trim();
  return name === "" || name === prefilled.trim() ? null : name;
}

/** A name the admin screen cannot store. The message is for the screen. */
export class InstanceNameError extends Error {
  override readonly name = "InstanceNameError";
}

export type InstanceRename = "renamed" | "cleared" | "unchanged";

/**
 * Renames the instance from administration, and records who did.
 *
 * **An empty name clears the stored one**, so the deployment's name applies
 * again. That is the way back for an operator who set a name here and now
 * wants `OPENOKR_INSTANCE_NAME` to decide.
 *
 * **Authorisation is the caller's.** Instance settings have no workspace, so
 * there is no aggregate for `can()` to answer about; the admin screen gates
 * this behind `full` and refuses it on a managed cloud, where the name
 * belongs to the operator rather than to any one customer.
 *
 * Written through `writeSettings`, the one path every instance setting takes,
 * and recorded on the instance audit chain, the home for an instance write
 * that the workspace chain cannot hold. Two transactions, as `grantOperator`
 * does: a lost audit row after a committed rename is the rarer failure than
 * the alternative of reimplementing the settings write here.
 */
export async function renameInstance(
  pool: Pool,
  ring: KeyRing,
  input: {
    readonly name: string;
    readonly userId: string;
    readonly workspaceId: string;
  },
  environment: Environment = process.env,
): Promise<InstanceRename> {
  if (input.name.length > INSTANCE_NAME_MAX_LENGTH) {
    throw new InstanceNameError(
      `The instance name must be ${INSTANCE_NAME_MAX_LENGTH} characters or fewer.`,
    );
  }
  const name = input.name.trim();
  const current = await readInstanceName(pool, environment);
  const by = { userId: input.userId, workspaceId: input.workspaceId };

  if (name === "") {
    if (current.source !== "database") {
      return "unchanged";
    }
    await clearSetting(pool, INSTANCE_NAME_KEY);
    await recordInstanceAuditEvent(pool, {
      action: "instance.renamed",
      payload: {
        from: current.value,
        to: deploymentInstanceName(environment),
        cleared: true,
        ...by,
      },
    });
    return "cleared";
  }

  if (name === current.value) {
    return "unchanged";
  }
  await writeSettings(pool, ring, [
    { key: INSTANCE_NAME_KEY, value: name, source: "admin" },
  ]);
  await recordInstanceAuditEvent(pool, {
    action: "instance.renamed",
    payload: { from: current.value, to: name, cleared: false, ...by },
  });
  return "renamed";
}
