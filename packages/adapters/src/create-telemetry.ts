import { OffTelemetry } from "./drivers/telemetry/off.ts";
import {
  OtelTelemetry,
  type OtelTelemetryOptions,
} from "./drivers/telemetry/otel.ts";
import type { Telemetry } from "./ports/telemetry.ts";

export interface TelemetryConfig extends OtelTelemetryOptions {
  /**
   * `observability.metrics`. On by default, because a meter that serves its
   * numbers to the operator's own endpoint sends nothing anywhere and a
   * product that has to be configured before it can be watched is a product
   * nobody watches.
   */
  readonly enabled?: boolean;
}

/**
 * Resolves the Telemetry port, the way every other port is resolved
 * (P7-T06a).
 *
 * There is no third driver and no address here on purpose. Exporting
 * measurements off the host is `observability.otlp.endpoint`, which arrives
 * with the traces at P7-T06c and is empty by default. Until then this
 * product cannot send a measurement anywhere, which is a property worth
 * being able to state plainly rather than a configuration nobody checked.
 */
export function createTelemetry(config: TelemetryConfig = {}): Telemetry {
  if (config.enabled === false) {
    return new OffTelemetry();
  }
  return new OtelTelemetry(config);
}
