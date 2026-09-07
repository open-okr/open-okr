/**
 * Turning a line of flags into one action's input (P5-T07c-a).
 *
 * **Everything here is decided before a socket is opened.** A flag the command
 * does not declare, a value the type refuses, an enum value that is not in the
 * list, a required flag that is absent: each is a usage error, named, with what
 * the command actually takes. The alternative is a round trip that comes back
 * 422 and a person guessing which of six flags it meant.
 *
 * **The tool refuses only what it can be sure about.** Types and enums come from
 * the action's own schema, so they are the schema's opinion rather than this
 * file's. Anything the generator could not read arrives as `string` and is
 * passed through, because a command line that refuses what the API would have
 * accepted is worse than one that lets the server answer.
 */
import { readFileSync } from "node:fs";
import type { CliCommand, CliFlag } from "./contract.ts";

/** Flags that belong to the tool rather than to any action. */
export interface Globals {
  readonly profile?: string;
  readonly url?: string;
  readonly token?: string;
  readonly cursor?: string;
  readonly help: boolean;
}

export type ParsedFlags =
  | {
      readonly kind: "ok";
      readonly input: Record<string, unknown>;
      readonly globals: Globals;
    }
  | { readonly kind: "error"; readonly message: string };

const GLOBAL_NAMES = new Set(["profile", "url", "token", "cursor", "help"]);

/**
 * A value from the command line, or from a file it names.
 *
 * `@` is the file marker, and `@@` escapes a literal one, so a value that really
 * starts with an at sign is still expressible. Reading from a file is what makes
 * a rich-text body or a long list usable at all: a shell cannot carry a JSON
 * document without a quoting argument nobody wins.
 */
function readValue(raw: string): { value: string } | { error: string } {
  if (raw.startsWith("@@")) {
    return { value: raw.slice(1) };
  }
  if (!raw.startsWith("@")) {
    return { value: raw };
  }
  const path = raw.slice(1);
  try {
    return { value: readFileSync(path, "utf8") };
  } catch {
    return { error: `Cannot read ${path}.` };
  }
}

/** One value, coerced to what the flag declares, or a refusal that says why. */
export function coerce(
  flag: CliFlag,
  raw: string,
): { value: unknown } | { error: string } {
  const read = readValue(raw);
  if ("error" in read) {
    return { error: `--${flag.name}: ${read.error}` };
  }
  const text = read.value;

  switch (flag.type) {
    case "boolean": {
      const lowered = text.trim().toLowerCase();
      if (lowered === "true" || lowered === "") {
        return { value: true };
      }
      if (lowered === "false") {
        return { value: false };
      }
      return {
        error: `--${flag.name} takes true or false, not "${text}".`,
      };
    }
    case "number":
    case "integer": {
      const value = Number(text.trim());
      if (!Number.isFinite(value)) {
        return { error: `--${flag.name} takes a number, not "${text}".` };
      }
      if (flag.type === "integer" && !Number.isInteger(value)) {
        return {
          error: `--${flag.name} takes a whole number, not "${text}".`,
        };
      }
      return { value };
    }
    case "array":
    case "object": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return {
          error: `--${flag.name} takes JSON. Pass it inline or as @file.json.`,
        };
      }
      const isArray = Array.isArray(parsed);
      if (flag.type === "array" && !isArray) {
        return { error: `--${flag.name} takes a JSON array.` };
      }
      if (
        flag.type === "object" &&
        (isArray || typeof parsed !== "object" || parsed === null)
      ) {
        return { error: `--${flag.name} takes a JSON object.` };
      }
      return { value: parsed };
    }
    default: {
      if (flag.enum && !flag.enum.includes(text)) {
        return {
          error: `--${flag.name} must be one of ${flag.enum.join(", ")}, not "${text}".`,
        };
      }
      return { value: text };
    }
  }
}

/** Whether a flag can be given with no value, `--include-closed`. */
const takesNoValue = (flag: CliFlag): boolean => flag.type === "boolean";

export function parseFlags(
  command: CliCommand,
  argv: readonly string[],
): ParsedFlags {
  const byName = new Map(command.flags.map((flag) => [flag.name, flag]));
  const input: Record<string, unknown> = {};
  const globals: { -readonly [K in keyof Globals]: Globals[K] } = {
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (!token.startsWith("--")) {
      return {
        kind: "error",
        message: `Unexpected argument "${token}". Every value is given as --flag value.`,
      };
    }

    // `--flag=value` as well as `--flag value`, because both are typed in
    // practice and refusing one is a paper cut with no upside.
    const equals = token.indexOf("=");
    const name = (equals === -1 ? token.slice(2) : token.slice(2, equals))
      .trim()
      .toLowerCase();
    const inline = equals === -1 ? null : token.slice(equals + 1);

    if (GLOBAL_NAMES.has(name)) {
      if (name === "help") {
        globals.help = true;
        continue;
      }
      const value = inline ?? argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { kind: "error", message: `--${name} needs a value.` };
      }
      if (inline === null) {
        index += 1;
      }
      globals[name as "profile" | "url" | "token" | "cursor"] = value;
      continue;
    }

    const flag = byName.get(name);
    if (!flag) {
      const known = command.flags.map((one) => `--${one.name}`).join(", ");
      return {
        kind: "error",
        message:
          known === ""
            ? `${command.name} takes no flags, and --${name} was given.`
            : `${command.name} has no flag --${name}. It takes: ${known}.`,
      };
    }

    let raw = inline;
    if (raw === null) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        if (!takesNoValue(flag)) {
          return { kind: "error", message: `--${flag.name} needs a value.` };
        }
        raw = "";
      } else {
        raw = next;
        index += 1;
      }
    }

    const coerced = coerce(flag, raw);
    if ("error" in coerced) {
      return { kind: "error", message: coerced.error };
    }
    input[flag.field] = coerced.value;
  }

  if (!globals.help) {
    const missing = command.flags
      .filter((flag) => flag.required && !(flag.field in input))
      .map((flag) => `--${flag.name}`);
    if (missing.length > 0) {
      return {
        kind: "error",
        message: `${command.name} needs ${missing.join(" and ")}.`,
      };
    }
  }

  return { kind: "ok", input, globals };
}

/** What `--help` prints for one command. */
export function commandHelp(command: CliCommand): string {
  const lines = [
    `okr ${command.name} — ${command.summary}`,
    "",
    `  ${command.method} /api/v1${command.path}, needs the ${command.scope} scope.`,
  ];
  if (command.flags.length > 0) {
    lines.push("", "Flags:");
    for (const flag of command.flags) {
      const parts = [`  --${flag.name}`, `<${flag.type}>`];
      if (flag.required) {
        parts.push("(required)");
      }
      if (flag.enum) {
        parts.push(`one of ${flag.enum.join(", ")}`);
      }
      lines.push(parts.join(" "));
    }
  }
  if (command.pages) {
    lines.push("", "  --cursor <string> the cursor from a previous answer");
  }
  return lines.join("\n");
}
