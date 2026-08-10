/**
 * The realtime driver: Postgres listen/notify, no extra service (PLAN.md §7).
 *
 * Two details this driver has to get right:
 *
 *  - **Channel names.** Ours look like `workspace:{uuid}:goal:{uuid}`, far
 *    past the 63-byte limit on a Postgres identifier, so the identifier is a
 *    hash and the logical channel travels inside the payload. Subscribers
 *    match on the logical name, which also makes a hash collision harmless.
 *  - **Payload size.** NOTIFY caps a payload at 8000 bytes. Events are hints,
 *    not data, so hitting the cap means the wrong thing is being sent and the
 *    driver raises instead of truncating.
 */
import { createHash } from "node:crypto";
import pg from "pg";
import {
  EventTooLargeError,
  MAX_EVENT_BYTES,
  type Realtime,
  type RealtimeEvent,
  type SubscribeOptions,
  type Subscription,
} from "../../ports/realtime.ts";

export interface PostgresRealtimeOptions {
  /** Connection settings for this driver's own client. LISTEN needs a
   * dedicated connection, so this is never a shared pool. */
  readonly connectionOptions: pg.ClientConfig;
  readonly onError?: (error: unknown) => void;
}

interface Envelope {
  readonly channel: string;
  readonly event: RealtimeEvent;
}

interface Listener {
  readonly channel: string;
  readonly handler: (event: RealtimeEvent) => void;
  readonly origin: string | undefined;
}

/** A valid, stable Postgres identifier for any logical channel name. */
const identifierFor = (channel: string): string =>
  `okr_${createHash("sha256").update(channel).digest("hex").slice(0, 32)}`;

export class PostgresRealtime implements Realtime {
  readonly #options: PostgresRealtimeOptions;
  /** Listeners by Postgres identifier, so one LISTEN serves many subscribers. */
  readonly #listeners = new Map<string, Set<Listener>>();
  #client: pg.Client | undefined;
  #connecting: Promise<pg.Client> | undefined;
  /** True only inside `stop()`, so its own `end` event is not reported as a drop. */
  #stopping = false;

  constructor(options: PostgresRealtimeOptions) {
    this.#options = options;
  }

  /**
   * Drops the current connection state so the next call reconnects.
   * Re-issues `listen` for every channel with a live subscriber once the new
   * connection is up, because a dropped connection forgets every `listen` it
   * held; without this, a reconnect would silently stop delivering to
   * subscribers who never unsubscribed.
   */
  #reset(error: unknown): void {
    this.#client = undefined;
    this.#connecting = undefined;
    if (!this.#stopping) {
      this.#options.onError?.(error);
    }
  }

  async #connection(): Promise<pg.Client> {
    if (this.#client) {
      return this.#client;
    }
    // Not memoised across a failure: a rejected #connecting promise used to
    // stay assigned forever (`??=` only replaces `undefined`), so one failed
    // connect poisoned every later publish and subscribe for the life of the
    // process. The catch below clears it before anything else can observe
    // the rejection, so the next call gets a fresh attempt.
    this.#connecting ??= (async () => {
      const client = new pg.Client(this.#options.connectionOptions);
      client.on("notification", (message) => this.#dispatch(message));
      client.on("error", (error) => this.#reset(error));
      client.on("end", () =>
        this.#reset(new Error("Realtime connection closed")),
      );
      await client.connect();
      this.#client = client;
      return client;
    })();

    try {
      const client = await this.#connecting;
      // A reconnect starts with no LISTENs on the new session; every
      // identifier this driver still has subscribers for needs reissuing.
      for (const identifier of this.#listeners.keys()) {
        await client.query(`listen ${identifier}`);
      }
      return client;
    } catch (error) {
      this.#connecting = undefined;
      throw error;
    }
  }

  #dispatch(message: pg.Notification): void {
    const listeners = this.#listeners.get(message.channel);
    if (!listeners || !message.payload) {
      return;
    }

    let envelope: Envelope;
    try {
      envelope = JSON.parse(message.payload) as Envelope;
    } catch {
      return;
    }

    for (const listener of listeners) {
      // Match the logical channel, not just the hashed identifier.
      if (listener.channel !== envelope.channel) {
        continue;
      }
      // Self-echo suppression: whoever caused the change already has it.
      if (
        envelope.event.origin !== undefined &&
        envelope.event.origin === listener.origin
      ) {
        continue;
      }
      try {
        listener.handler(envelope.event);
      } catch (error) {
        this.#options.onError?.(error);
      }
    }
  }

  async publish(channel: string, event: RealtimeEvent): Promise<void> {
    const envelope: Envelope = {
      channel,
      event: { ...event, at: event.at ?? new Date().toISOString() },
    };
    const payload = JSON.stringify(envelope);

    const bytes = Buffer.byteLength(payload, "utf8");
    if (bytes > MAX_EVENT_BYTES) {
      throw new EventTooLargeError(bytes);
    }

    const client = await this.#connection();
    // pg_notify takes the channel as a value, so no identifier quoting is
    // needed and nothing user-supplied reaches the SQL text.
    await client.query("select pg_notify($1, $2)", [
      identifierFor(channel),
      payload,
    ]);
  }

  async subscribe(
    channel: string,
    handler: (event: RealtimeEvent) => void,
    options?: SubscribeOptions,
  ): Promise<Subscription> {
    const identifier = identifierFor(channel);
    const listener: Listener = { channel, handler, origin: options?.origin };

    const existing = this.#listeners.get(identifier);
    if (existing) {
      existing.add(listener);
    } else {
      this.#listeners.set(identifier, new Set([listener]));
      const client = await this.#connection();
      // The identifier is a hash of our own making, so it is safe to inline
      // and cannot carry anything a caller supplied.
      await client.query(`listen ${identifier}`);
    }

    return {
      unsubscribe: async () => {
        const listeners = this.#listeners.get(identifier);
        if (!listeners) {
          return;
        }
        listeners.delete(listener);
        if (listeners.size === 0) {
          this.#listeners.delete(identifier);
          await this.#client?.query(`unlisten ${identifier}`);
        }
      },
    };
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    this.#listeners.clear();
    const client = this.#client;
    this.#client = undefined;
    this.#connecting = undefined;
    await client?.end();
    this.#stopping = false;
  }
}
