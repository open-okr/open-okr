/**
 * Named profiles, each a URL and a token (P5-T07c-a).
 *
 * **A token on disk is a credential on disk.** The file is created with owner
 * only permissions where the platform has them, and the tool prints a prefix
 * rather than a token whenever it has to name one. Windows has no mode bits that
 * `chmod` reaches, so there the file's protection is the user's own profile
 * directory, and this says so rather than pretending otherwise.
 *
 * **More than one, because more than one instance is normal.** A person with a
 * self-hosted instance and the managed cloud has two, and a person testing a
 * staging deployment has three. `--profile` picks one for a single command;
 * `default` is used when none is named.
 */
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

export interface Profile {
  readonly url: string;
  readonly token: string;
}

export interface Config {
  /** Which profile a command with no `--profile` uses. */
  readonly current: string;
  readonly profiles: Readonly<Record<string, Profile>>;
}

export const EMPTY: Config = { current: "default", profiles: {} };

/**
 * Where the configuration lives.
 *
 * `OPENOKR_CONFIG` overrides it outright, which is what the tests use and what
 * somebody running two identities on one machine needs.
 */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.OPENOKR_CONFIG) {
    return env.OPENOKR_CONFIG;
  }
  if (platform() === "win32") {
    const base = env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(base, "openokr", "config.json");
  }
  const base = env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "openokr", "config.json");
}

export function readConfig(path: string = configPath()): Config {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    // No file is not an error: it is a tool nobody has logged into yet.
    return EMPTY;
  }
  try {
    const parsed = JSON.parse(text) as Partial<Config>;
    return {
      current: parsed.current ?? "default",
      profiles: parsed.profiles ?? {},
    };
  } catch {
    throw new Error(`${path} is not valid JSON. Fix or delete it.`);
  }
}

export function writeConfig(config: Config, path: string = configPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  if (platform() !== "win32") {
    // Owner read and write. Anything wider is a token other accounts can read.
    chmodSync(path, 0o600);
  }
}

export function saveProfile(
  name: string,
  profile: Profile,
  path: string = configPath(),
): Config {
  const current = readConfig(path);
  const next: Config = {
    // The first profile somebody creates becomes the default, because a tool
    // that needs `--profile` on the very first command is a tool that made
    // somebody read the help to do the obvious thing.
    current:
      Object.keys(current.profiles).length === 0 ? name : current.current,
    profiles: { ...current.profiles, [name]: profile },
  };
  writeConfig(next, path);
  return next;
}

export function removeProfile(name: string, path: string = configPath()): void {
  const current = readConfig(path);
  const profiles = { ...current.profiles };
  delete profiles[name];
  const names = Object.keys(profiles);
  writeConfig(
    {
      current: names.includes(current.current)
        ? current.current
        : (names[0] ?? "default"),
      profiles,
    },
    path,
  );
  if (names.length === 0) {
    // Nothing left to protect. Leaving an empty file behind is a small lie
    // about there being a login.
    try {
      rmSync(path);
    } catch {
      // Already gone, or not ours to remove. Either way there is no token in it.
    }
  }
}

/** The URL and token a command should use, or a message saying what is missing. */
export function resolveProfile(
  config: Config,
  chosen: string | undefined,
  overrides: { readonly url?: string; readonly token?: string },
): { profile: Profile; name: string } | { error: string } {
  if (overrides.url && overrides.token) {
    return {
      profile: { url: overrides.url, token: overrides.token },
      name: "(flags)",
    };
  }

  const name = chosen ?? config.current;
  const stored = config.profiles[name];
  if (!stored) {
    const known = Object.keys(config.profiles);
    return {
      error:
        known.length === 0
          ? "No profile yet. Run `okr login --url <instance> --token <token>`, with a token from /account/api-tokens."
          : `No profile called "${name}". There is: ${known.join(", ")}.`,
    };
  }
  return {
    profile: {
      url: overrides.url ?? stored.url,
      token: overrides.token ?? stored.token,
    },
    name,
  };
}

/** Enough of a token to recognise, never enough to use. */
export function tokenHint(token: string): string {
  return `${token.slice(0, 16)}…`;
}
