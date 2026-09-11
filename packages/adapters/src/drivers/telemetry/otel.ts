import type { Counter, Histogram, Meter } from "@opentelemetry/api";
import {
  PrometheusExporter,
  PrometheusSerializer,
} from "@opentelemetry/exporter-prometheus";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { MeterProvider } from "@opentelemetry/sdk-metrics";

import type { MetricLabels, Telemetry } from "../../ports/telemetry.ts";

/**
 * Bucket edges for every duration this product records, in seconds.
 *
 * **The SDK's defaults are wrong here and silently so.** They run
 * `0, 5, 10, 25 … 10000`, which are milliseconds-shaped: against values in
 * seconds every observation lands in the first real bucket, the histogram
 * reports one number, and any percentile drawn from it is a straight line.
 * Found on 11 September 2026 by reading the exposition rather than by any
 * test, because a histogram with useless buckets is still a valid histogram.
 *
 * These run from five milliseconds to ten seconds with the usual 1-2-5
 * spacing, and the edges either side of TECHNICAL-PLAN §13.1's budgets are
 * present so a budget can be read off the chart rather than interpolated.
 */
const SECOND_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;

/**
 * What each series means, rendered into the `# HELP` line.
 *
 * Without it every series says `description missing`, which is what an
 * operator reads first and the only documentation a scraped metric carries
 * with it. Keyed by name rather than passed at the call site, because the
 * call sites are in `packages/core` and the names are the contract between
 * the two.
 */
const DESCRIPTIONS: Readonly<Record<string, string>> = {
  openokr_actions_total:
    "Actions called through the contract registry, by name and outcome.",
  openokr_action_duration_seconds:
    "Wall time of one action, from call to return or throw.",
  openokr_operations_total:
    "Operations committed or rolled back, by action and outcome.",
  openokr_operation_duration_seconds:
    "Wall time of one Operation's transaction.",
  openokr_authorisation_total:
    "Authorisation decisions, by action, the level it required and the outcome.",
};

function descriptionFor(name: string): string {
  return DESCRIPTIONS[name] ?? "";
}

export interface OtelTelemetryOptions {
  /** Names this process in the exposition. Defaults to `openokr`. */
  readonly serviceName?: string;
  /**
   * Distinguishes one replica from another in the exposition. Unset is
   * correct for a single-process install and is the common case.
   */
  readonly instanceId?: string;
}

/**
 * The OpenTelemetry metrics driver (PLAN.md §183, P7-T06a).
 *
 * **The exporter is constructed with its own HTTP server suppressed.**
 * `PrometheusExporter` normally binds port 9464 and serves `/metrics`
 * itself. A second listening socket is the wrong shape here: this product
 * already has a server, the endpoint has to sit behind the same
 * administrator session as every other operator surface, and a port that
 * opens itself is exactly what an air-gapped install is entitled not to get.
 * With `preventServerStart` the exporter is only a pull-based reader, and
 * `scrape` below does the serving.
 *
 * `PrometheusSerializer` is the exporter's own renderer, used directly
 * rather than reimplemented. Prometheus text format has enough edge cases
 * (escaping, histogram bucket layout, the `# UNIT` line) that hand-rolling
 * it would be a second implementation to keep correct for no gain.
 */
export class OtelTelemetry implements Telemetry {
  readonly #provider: MeterProvider;
  readonly #reader: PrometheusExporter;
  readonly #meter: Meter;
  readonly #serializer = new PrometheusSerializer();
  readonly #counters = new Map<string, Counter>();
  readonly #histograms = new Map<string, Histogram>();
  #stopped = false;

  constructor(options: OtelTelemetryOptions = {}) {
    // `preventServerStart` is the whole reason this driver is shaped the way
    // it is. See the class note.
    this.#reader = new PrometheusExporter({ preventServerStart: true });
    this.#provider = new MeterProvider({
      readers: [this.#reader],
      resource: resourceFromAttributes({
        "service.name": options.serviceName ?? "openokr",
        ...(options.instanceId
          ? { "service.instance.id": options.instanceId }
          : {}),
      }),
    });
    this.#meter = this.#provider.getMeter("openokr");
  }

  count(name: string, labels?: MetricLabels, by = 1): void {
    if (this.#stopped) {
      return;
    }
    this.#counter(name).add(by, labels);
  }

  observe(name: string, seconds: number, labels?: MetricLabels): void {
    if (this.#stopped) {
      return;
    }
    this.#histogram(name).record(seconds, labels);
  }

  async scrape(): Promise<string> {
    if (this.#stopped) {
      return "# the meter has been stopped\n";
    }
    const { resourceMetrics } = await this.#reader.collect();
    return this.#serializer.serialize(resourceMetrics);
  }

  async stop(): Promise<void> {
    if (this.#stopped) {
      return;
    }
    this.#stopped = true;
    await this.#provider.shutdown();
  }

  /**
   * Instruments are created once and reused.
   *
   * `createCounter` with the same name twice returns a distinct object in
   * some SDK versions and logs a duplicate-registration warning in others,
   * and this is on the path of every action. Caching is both the cheap thing
   * and the correct one.
   */
  #counter(name: string): Counter {
    let counter = this.#counters.get(name);
    if (!counter) {
      counter = this.#meter.createCounter(name, {
        description: descriptionFor(name),
      });
      this.#counters.set(name, counter);
    }
    return counter;
  }

  #histogram(name: string): Histogram {
    let histogram = this.#histograms.get(name);
    if (!histogram) {
      // The unit is declared rather than baked into the name. The serializer
      // renders it as a `# UNIT` line and leaves the name alone, so the
      // `_seconds` suffix this product uses has to be in the name already.
      histogram = this.#meter.createHistogram(name, {
        unit: "s",
        description: descriptionFor(name),
        advice: { explicitBucketBoundaries: [...SECOND_BUCKETS] },
      });
      this.#histograms.set(name, histogram);
    }
    return histogram;
  }
}
