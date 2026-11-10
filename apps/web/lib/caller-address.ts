import {
  callerAddressReading,
  describeCallerAddressReading,
} from "@openokr/config";
import { recordCallerAddressReading } from "@openokr/core";
import { getPool } from "./pool";

/**
 * Says which reading of the caller's address is in force, and records a change
 * of it on the instance chain (docs/design/trusted-proxies.md D10, D11).
 *
 * One log line an operator can read after a deployment without opening a
 * shell, and nothing secret in it: an address range is not a credential.
 * The audit row is written only when the reading differs from the newest one
 * recorded, so a restart with nothing changed writes nothing.
 *
 * Never fatal. The reading is already in force whatever happens here, and an
 * instance that could not write one audit row must still serve.
 */
export async function announceCallerAddress(): Promise<void> {
  const reading = callerAddressReading();
  process.stdout.write(`${describeCallerAddressReading(reading)}\n`);
  try {
    await recordCallerAddressReading(getPool(), reading);
  } catch (error) {
    process.stderr.write(
      `caller address: could not record the reading: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}
