import type {
  Counter,
  Histogram,
  Meter,
  ObservableGauge,
  Tracer,
} from "@opentelemetry/api";
import { SpanStatusCode } from "@opentelemetry/api";
import {
  PrometheusExporter,
  PrometheusSerializer,
} from "@opentelemetry/exporter-prometheus";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import {
  BatchSpanProcessor,
  NodeTracerProvider,
} from "@opentelemetry/sdk-trace-node";

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
  openokr_outbox_dispatched_total:
    "Outbox rows dispatched, by topic and outcome.",
  openokr_outbox_pending: "Outbox rows waiting to be delivered.",
  openokr_outbox_oldest_pending_seconds:
    "Age of the oldest outbox row still waiting. Grows while the relay is stopped.",
  openokr_outbox_dead_lettered_total:
    "Outbox rows given up on after the attempt ceiling, by topic.",
  openokr_job_runs_total: "Scheduled runs finished, by job name and outcome.",
  openokr_job_duration_seconds: "Wall time of one scheduled run.",
  openokr_nudges_total:
    "Nudges resolved, by rule and whether they were sent or why they were suppressed.",
  openokr_channel_deliveries_total:
    "Channel messages attempted, by provider and outcome. Never carries message content.",
  openokr_realtime_events_total: "Realtime events published, by topic.",
  openokr_agent_runs_total: "Agent runs finished, by agent and outcome.",
  openokr_agent_run_duration_seconds: "Wall time of one agent run.",
  openokr_ai_tokens_total: "Tokens spent, by provider, model and direction.",
  openokr_ai_cost_total:
    "Money spent on AI, by provider and model, in the smallest currency unit.",
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
  /**
   * Where to send spans, from `observability.otlp.endpoint` (P7-T06c).
   *
   * **Empty or absent means no tracer is built at all**, and that is the
   * default. This is the only value in the whole product that can make a
   * measurement leave the host, so it is worth being able to say plainly:
   * with nothing here, no exporter object exists, no socket is opened, and
   * `span` is a function call.
   */
  readonly otlpEndpoint?: string;
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
  /**
   * The scope label is switched off.
   *
   * The serializer stamps `otel_scope_name` on every series. That earns its
   * place in a process with several instrumentation libraries reporting
   * through one meter; this product has exactly one scope, so the label is
   * the same value on every line of every scrape. It costs bytes on each
   * read and it has to be typed into or ignored by every query an operator
   * writes.
   *
   * Positional because the constructor takes no options object:
   * (prefix, appendTimestamp, withResourceConstantLabels, withoutTargetInfo,
   * withoutScopeInfo). `target_info` is kept, because it carries the service
   * name and is one line rather than one per series.
   */
  readonly #serializer = new PrometheusSerializer(
    undefined,
    false,
    undefined,
    false,
    true,
  );
  readonly #counters = new Map<string, Counter>();
  readonly #histograms = new Map<string, Histogram>();
  readonly #gauges = new Map<string, ObservableGauge>();
  readonly #gaugeReaders = new Map<
    string,
    { read: () => number | Promise<number>; labels?: MetricLabels }
  >();
  readonly #resource: ReturnType<typeof resourceFromAttributes>;
  readonly #tracerProvider: NodeTracerProvider | undefined;
  readonly #tracer: Tracer | undefined;
  #stopped = false;

  constructor(options: OtelTelemetryOptions = {}) {
    this.#resource = resourceFromAttributes({
      "service.name": options.serviceName ?? "openokr",
      ...(options.instanceId
        ? { "service.instance.id": options.instanceId }
        : {}),
    });
    // `preventServerStart` is the whole reason this driver is shaped the way
    // it is. See the class note.
    this.#reader = new PrometheusExporter({ preventServerStart: true });
    this.#provider = new MeterProvider({
      readers: [this.#reader],
      resource: this.#resource,
    });
    this.#meter = this.#provider.getMeter("openokr");

    // **Built only when there is somewhere to send spans.** An exporter with
    // no address is an exporter that batches into memory and drops, which
    // costs allocation on every action for nothing. With no endpoint there
    // is no provider, no exporter and no socket, and `span` below is one
    // function call. That is the property the acceptance criterion turns on.
    if (options.otlpEndpoint) {
      this.#tracerProvider = new NodeTracerProvider({
        resource: this.#resource,
        spanProcessors: [
          new BatchSpanProcessor(
            // **Five seconds, not the SDK's thirty.** A collector that is
            // down should cost a process five seconds on the way out, not
            // half a minute: `stop` waits for this flush, and a container
            // orchestrator that sends SIGTERM and waits ten seconds would
            // kill the process mid-wait and lose the spans anyway. Spans are
            // the most disposable thing this product produces and must never
            // be what keeps it from exiting.
            new OTLPTraceExporter({
              url: options.otlpEndpoint,
              timeoutMillis: 5_000,
            }),
            { exportTimeoutMillis: 5_000 },
          ),
        ],
      });
      this.#tracer = this.#tracerProvider.getTracer("openokr");
    }
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

  gauge(
    name: string,
    read: () => number | Promise<number>,
    labels?: MetricLabels,
  ): void {
    if (this.#stopped) {
      return;
    }
    // The reader is replaced rather than added, and the instrument is created
    // once. Registering a second callback on the same instrument would make
    // the series report both values on every scrape, which reads as a
    // flapping gauge rather than as the duplicate registration it is.
    this.#gaugeReaders.set(name, { read, labels });
    if (this.#gauges.has(name)) {
      return;
    }

    const instrument = this.#meter.createObservableGauge(name, {
      description: descriptionFor(name),
      ...(name.endsWith("_seconds") ? { unit: "s" } : {}),
    });
    instrument.addCallback(async (result) => {
      const registered = this.#gaugeReaders.get(name);
      if (!registered) {
        return;
      }
      try {
        result.observe(await registered.read(), registered.labels);
      } catch {
        // A gauge whose reader throws reports nothing for that scrape rather
        // than failing the whole collection. One unreadable series must not
        // take the exposition down with it, and the gap is visible on the
        // chart, which is the honest signal.
      }
    });
    this.#gauges.set(name, instrument);
  }

  span<T>(
    name: string,
    attributes: MetricLabels,
    fn: () => Promise<T>,
  ): Promise<T> {
    const tracer = this.#tracer;
    if (!tracer || this.#stopped) {
      // No endpoint configured, so nothing is tracing. The function, not a
      // wrapper around it.
      return fn();
    }
    return tracer.startActiveSpan(name, { attributes }, async (active) => {
      try {
        const result = await fn();
        active.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        // **The type, never the message.** An error message from this
        // product can name a goal, quote a member's input or echo a
        // provider's body, and a span leaves the host. The class name says
        // which failure it was, which is what a trace is for, and the
        // message stays in the log where access control applies.
        active.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.name : "unknown",
        });
        throw error;
      } finally {
        active.end();
      }
    });
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
    // The tracer first, so a batch already collected is flushed before the
    // process stops rather than dropped with it.
    //
    // **The flush may fail and must not fail the shutdown.** A collector
    // that is down, or an address an operator mistyped, makes this reject
    // with a connection error. Letting that escape would mean an unreachable
    // tracing endpoint could take down a process that was only trying to
    // exit, which is an observability feature turned into an availability
    // risk. The spans are lost either way; the difference is whether
    // anything else is.
    await this.#tracerProvider?.shutdown().catch((error: unknown) => {
      process.stderr.write(
        `telemetry: could not flush spans on shutdown: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
    });
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
