export const PACKAGE_NAME = "@openokr/config";

export {
  type CallerAddressReading,
  callerAddressReading,
  describeCallerAddressReading,
} from "./caller-address.ts";
export {
  type Env,
  EnvironmentError,
  loadEnv,
  parseEnv,
  resetEnvCache,
  // The extension is required. Bundlers resolve it either way, but a plain
  // `node --experimental-strip-types` entry point does not, and that is how
  // db:migrate, db:seed and db:change run.
} from "./env.ts";
