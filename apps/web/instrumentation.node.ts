import { EnvironmentError, loadEnv } from "@openokr/config";

/**
 * Node-only boot checks. Kept out of `instrumentation.ts` so the edge bundle
 * never sees `process.exit`, which the edge runtime forbids.
 */
export function validateEnvironment(): void {
  try {
    loadEnv();
  } catch (error) {
    if (error instanceof EnvironmentError) {
      process.stderr.write(`\nOpenOKR cannot start.\n\n${error.message}\n`);
      process.exit(1);
      // Unreachable in production. Tests stub process.exit, and without this
      // the error below would escape and hide the message we just wrote.
      return;
    }

    throw error;
  }
}
