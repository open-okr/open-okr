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
 * (P7-T06a, tracing added at P7-T06c).
 *
 * Two switches, and they are separate because they mean different things.
 * `enabled` decides whether this instance measures itself at all, and it
 * defaults to on because the exposition is local. `otlpEndpoint` decides
 * whether anything leaves the host, and it defaults to empty: with no
 * address, no exporter is constructed, no socket is opened, and `span` is a
 * plain function call. That is the whole of the "zero external calls"
 * claim, and it is one branch rather than a policy anybody has to trust.
 */
export function createTelemetry(config: TelemetryConfig = {}): Telemetry {
  if (config.enabled === false) {
    return new OffTelemetry();
  }
  return new OtelTelemetry(config);
}
