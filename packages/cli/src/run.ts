/**
 * The whole tool as one function (P5-T07c-a).
 *
 * A function rather than a script, so the tests drive it exactly as a terminal
 * does: an argument list in, text and an exit code out, no process to spawn and
 * no output to scrape.
 *
 * **Three exit codes, and they mean different things.** 0 is the answer. 2 is a
 * usage error, decided here before anything was sent. 1 is the instance
 * refusing or failing. A script that retries on 1 and gives up on 2 is doing the
 * right thing, which is the point of separating them.
 */
import {
  type CliContract,
  commandsIn,
  domainsOf,
  findCommand,
  loadContract,
} from "./contract.ts";
import { openBrowser, pollDevice, startDevice } from "./device.ts";
import { commandHelp, parseFlags } from "./flags.ts";
import {
  type Config,
  configPath,
  readConfig,
  removeProfile,
  resolveProfile,
  saveProfile,
  tokenHint,
} from "./profiles.ts";
import { describe, send } from "./request.ts";

export interface RunOptions {
  readonly contract?: CliContract;
  readonly configFile?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Where the device login's progress is written (P5-T07c-b).
   *
   * A login prints a link and then waits, so it cannot hold its output until the
   * end the way every other command does: a person needs the link *now*.
   * Defaults to stderr, which keeps it out of a pipe.
   */
  readonly say?: (line: string) => void;
  /** How the poll waits. Passed in so a test does not spend ten seconds. */
  readonly wait?: (milliseconds: number) => Promise<void>;
  /** Opens the browser. Passed in so a test does not open one. */
  readonly open?: (url: string) => void;
}

export interface RunResult {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

const ok = (out: string): RunResult => ({ code: 0, out, err: "" });
const usage = (err: string): RunResult => ({ code: 2, out: "", err });
const failed = (err: string): RunResult => ({ code: 1, out: "", err });

function topHelp(contract: CliContract): string {
  return [
    "okr — OpenOKR from a terminal.",
    "",
    "  okr <domain> <verb> [--flag value]",
    "  okr login --url <instance> [--token <token>] [--no-browser]",
    "  okr logout [--profile name]",
    "  okr profiles",
    "",
    `${contract.commands.length} commands in these domains:`,
    ...chunk(domainsOf(contract), 6).map((line) => `  ${line.join("  ")}`),
    "",
    "  okr <domain> --help    the commands in one domain",
    "  okr <domain> <verb> --help    one command's flags",
    "",
    "A token comes from /account/api-tokens and carries your own access,",
    "narrowed by the scopes you gave it.",
  ].join("\n");
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

function domainHelp(contract: CliContract, domain: string): string | null {
  const commands = commandsIn(contract, domain);
  if (commands.length === 0) {
    return null;
  }
  return [
    `okr ${domain} — ${commands.length} commands.`,
    "",
    ...commands.map((command) => `  ${command.name}  ${command.summary}`),
  ].join("\n");
}

function profilesText(config: Config, path: string): string {
  const names = Object.keys(config.profiles);
  if (names.length === 0) {
    return `No profiles yet. ${path} does not exist.`;
  }
  return [
    `Profiles in ${path}:`,
    ...names.map((name) => {
      const profile = config.profiles[name];
      const marker = name === config.current ? "*" : " ";
      return `${marker} ${name}  ${profile?.url}  ${tokenHint(profile?.token ?? "")}`;
    }),
    "",
    "* is the one used when --profile is not given.",
  ].join("\n");
}

/**
 * `okr login`.
 *
 * Two ways in, and the difference is whether a token was supplied. With one, it
 * is stored. Without one, the device login runs: the instance is asked to start
 * a request, the link is printed, and this waits for somebody to answer it in a
 * browser. Nothing here ever holds a password.
 */
async function login(
  argv: readonly string[],
  file: string,
  options: RunOptions,
): Promise<RunResult> {
  const flags = simpleFlags(argv);
  const url = flags.url;
  if (!url) {
    return usage(
      "okr login needs --url. Add --token to store one you already have, or leave it out and approve the login in a browser.",
    );
  }
  if (!/^https?:\/\//i.test(url)) {
    return usage(`--url must start with http:// or https://, not "${url}".`);
  }
  const name = flags.profile ?? "default";

  if (flags.token) {
    saveProfile(name, { url, token: flags.token }, file);
    // Never the token itself: a terminal scrollback is a place secrets survive.
    return ok(
      `Saved profile "${name}" for ${url} (${tokenHint(flags.token)}).`,
    );
  }

  return deviceLogin({ url, name, file, flags, options });
}

/** The scopes a login asks for when nobody says. */
const DEFAULT_SCOPES = ["read", "write"] as const;

async function deviceLogin(input: {
  readonly url: string;
  readonly name: string;
  readonly file: string;
  readonly flags: Record<string, string>;
  readonly options: RunOptions;
}): Promise<RunResult> {
  const say = input.options.say ?? (() => {});
  const wait =
    input.options.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
      }));
  // **`--no-browser` opens nothing.** A login over SSH, in a container, or on a
  // machine whose browser belongs to somebody who is using it should print the
  // link and stop there. The end-to-end suite passes it for exactly that
  // reason: a test run must not put a tab in the window of whoever is watching
  // it, which it did until somebody watching said so.
  const wanted = input.flags["no-browser"] === undefined;
  const open = input.options.open ?? (wanted ? openBrowser : () => {});
  const call = input.options.fetch ?? globalThis.fetch;

  // Asked for explicitly or read and write, which is what a person at a terminal
  // usually wants. Never destructive by default: that scope removes things other
  // people can see, and a login should not quietly acquire it.
  const scopes = input.flags.scopes
    ? input.flags.scopes.split(",").map((scope) => scope.trim())
    : [...DEFAULT_SCOPES];

  let started: Awaited<ReturnType<typeof startDevice>>;
  try {
    started = await startDevice(input.url, scopes, call);
  } catch (error) {
    return failed(
      `Could not reach ${input.url}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if ("error" in started) {
    return failed(started.error);
  }

  const { deviceCode, userCode, verificationUri, interval, expiresIn } =
    started.started;
  say(`Open this to authorise this terminal:\n  ${verificationUri}`);
  say(
    `The code is ${userCode}. It expires in ${Math.round(expiresIn / 60)} minutes.`,
  );
  open(verificationUri);

  let every = Math.max(1, interval) * 1000;
  const deadline = Date.now() + expiresIn * 1000;
  while (Date.now() < deadline) {
    await wait(every);
    let poll: Awaited<ReturnType<typeof pollDevice>>;
    try {
      poll = await pollDevice(input.url, deviceCode, call);
    } catch (error) {
      return failed(
        `Could not reach ${input.url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (poll.kind === "granted") {
      saveProfile(
        input.name,
        { url: input.url, token: poll.token },
        input.file,
      );
      return ok(
        `Saved profile "${input.name}" for ${input.url} (${tokenHint(poll.token)}).`,
      );
    }
    if (poll.kind === "ended") {
      return failed(poll.message);
    }
    if (poll.slowDown) {
      // The protocol asking for more room. Doubling rather than adding, because
      // a client that is too fast is usually much too fast.
      every *= 2;
    }
  }
  return failed("That login expired before anybody answered it.");
}

/** A tiny parser for the tool's own commands, which have no action behind them. */
function simpleFlags(argv: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (!token.startsWith("--")) {
      continue;
    }
    const equals = token.indexOf("=");
    const name = equals === -1 ? token.slice(2) : token.slice(2, equals);
    const inline = equals === -1 ? null : token.slice(equals + 1);
    const next = argv[index + 1];
    if (inline !== null) {
      values[name] = inline;
    } else if (next !== undefined && !next.startsWith("--")) {
      values[name] = next;
      index += 1;
    } else {
      values[name] = "";
    }
  }
  return values;
}

export async function run(
  argv: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  let contract: CliContract;
  try {
    contract = options.contract ?? loadContract();
  } catch (error) {
    return failed(
      error instanceof Error ? error.message : "Cannot read the command list.",
    );
  }

  const file = options.configFile ?? configPath(options.env);
  const words = [...argv];

  if (words.length === 0 || words[0] === "help" || words[0] === "--help") {
    return ok(topHelp(contract));
  }

  if (words[0] === "login") {
    return login(words.slice(1), file, options);
  }

  if (words[0] === "logout") {
    const name =
      simpleFlags(words.slice(1)).profile ?? readConfig(file).current;
    removeProfile(name, file);
    return ok(`Removed profile "${name}".`);
  }

  if (words[0] === "profiles") {
    return ok(profilesText(readConfig(file), file));
  }

  const found = findCommand(contract, words);
  if (!found) {
    // A domain on its own lists its commands, which is what somebody who typed
    // half a command wants rather than "unknown command".
    const help = domainHelp(contract, words[0] as string);
    if (help) {
      return ok(help);
    }
    return usage(
      `No command "${words.join(" ")}". Run \`okr help\` for the domains.`,
    );
  }

  const parsed = parseFlags(found.command, words.slice(found.consumed));
  if (parsed.kind === "error") {
    return usage(parsed.message);
  }
  if (parsed.globals.help) {
    return ok(commandHelp(found.command));
  }

  const config = readConfig(file);
  const resolved = resolveProfile(config, parsed.globals.profile, {
    ...(parsed.globals.url ? { url: parsed.globals.url } : {}),
    ...(parsed.globals.token ? { token: parsed.globals.token } : {}),
  });
  if ("error" in resolved) {
    return usage(resolved.error);
  }

  let answer: Awaited<ReturnType<typeof send>>;
  try {
    answer = await send(found.command, parsed.input, resolved.profile, {
      ...(parsed.globals.cursor ? { cursor: parsed.globals.cursor } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  } catch (error) {
    return failed(
      `Could not reach ${resolved.profile.url}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!answer.ok) {
    return failed(describe(answer));
  }

  const lines = [JSON.stringify(answer.data, null, 2)];
  if (answer.nextCursor) {
    // On stdout with the data would corrupt a pipe into `jq`. This is the
    // one place the tool says something alongside an answer, so it goes to
    // stderr where a pipe does not carry it.
    return {
      code: 0,
      out: lines.join("\n"),
      err: `More to read. Add --cursor ${answer.nextCursor}`,
    };
  }
  return ok(lines.join("\n"));
}
