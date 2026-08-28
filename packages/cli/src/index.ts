/**
 * The command line, as a library (P5-T07c-a).
 *
 * `run` is the whole tool; the rest is exported because the tests exercise the
 * parsing and the profile handling directly, which is where the decisions are.
 */
export {
  ARTIFACT_PATH,
  type CliCommand,
  type CliContract,
  type CliFlag,
  commandsIn,
  domainsOf,
  type FlagType,
  findCommand,
  loadContract,
} from "./contract.ts";
export { coerce, commandHelp, type Globals, parseFlags } from "./flags.ts";
export {
  type Config,
  configPath,
  EMPTY,
  type Profile,
  readConfig,
  removeProfile,
  resolveProfile,
  saveProfile,
  tokenHint,
  writeConfig,
} from "./profiles.ts";
export { type Answer, describe, queryFor, send, urlFor } from "./request.ts";
export { type RunOptions, type RunResult, run } from "./run.ts";
