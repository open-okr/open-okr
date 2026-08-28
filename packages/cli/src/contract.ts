/**
 * The generated command list, as the tool reads it (P5-T07c-a).
 *
 * **This package has no runtime dependency on anything.** It reads one JSON file
 * and calls `fetch`. `@openokr/core` appears only in a type-only import, which
 * TypeScript erases, so the types are declared once in the generator and the
 * terminal tool still carries no Drizzle, no Postgres driver and no domain code.
 * That is the difference between a generated client and a client that happens to
 * live in the same repository.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CliCommand, CliContract } from "@openokr/core";

export type { CliCommand, CliContract, CliFlag, FlagType } from "@openokr/core";

/**
 * Where the artifact is, relative to this file.
 *
 * The monorepo layout is written down here rather than discovered, because a
 * search up the tree for a `contract/` directory would find somebody else's on a
 * machine with an unlucky parent directory.
 */
export const ARTIFACT_PATH = resolve(
  import.meta.dirname,
  "../../../contract/cli.json",
);

export function loadContract(path: string = ARTIFACT_PATH): CliContract {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as CliContract;
  if (!Array.isArray(parsed.commands)) {
    throw new Error(
      `${path} is not a command list. Run \`pnpm gen:contract\` to rebuild it.`,
    );
  }
  return parsed;
}

/**
 * The command named by the first words of the argument list.
 *
 * Returns how many words it consumed, so the caller knows where the flags start.
 * Two words today, because every command is `domain verb`, but reading it back
 * from the match rather than assuming two means a one-word command later needs
 * no change here.
 */
export function findCommand(
  contract: CliContract,
  words: readonly string[],
): { command: CliCommand; consumed: number } | null {
  const joined = words.join(" ").toLowerCase();
  for (const command of contract.commands) {
    const name = command.name.toLowerCase();
    if (joined === name || joined.startsWith(`${name} `)) {
      return { command, consumed: command.name.split(" ").length };
    }
  }
  return null;
}

/** Every command in one domain, for the help text. */
export function commandsIn(
  contract: CliContract,
  domain: string,
): readonly CliCommand[] {
  return contract.commands.filter((command) =>
    command.name.startsWith(`${domain} `),
  );
}

export function domainsOf(contract: CliContract): readonly string[] {
  return [
    ...new Set(contract.commands.map((command) => command.name.split(" ")[0])),
  ].filter((domain): domain is string => Boolean(domain));
}
