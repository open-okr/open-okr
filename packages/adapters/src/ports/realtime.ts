/**
 * The Realtime port (TECHNICAL-PLAN §5, PLAN.md §7).
 *
 * Compact typed events on channels like `workspace:{id}:goal:{id}`. Events
 * are notifications, not data: a client that receives one refetches through
 * the normal read path, which keeps row-level security and `can()` in the
 * loop. Never put protected data in an event payload.
 *
 * The event catalogue itself lives in `packages/core` (the typed event
 * registry). This port only defines the envelope every driver carries.
 */

export interface RealtimeEvent<TData = Record<string, unknown>> {
  /** Event name from the core registry, for example `goal.updated`. */
  readonly name: string;
  /** Compact hint data only. Identifiers and counts, never protected content. */
  readonly data: TData;
  /**
   * Who caused this event. A subscriber passing the same origin does not
   * receive it back, so the client that just wrote does not refetch its own
   * change (self-echo suppression).
   */
  readonly origin?: string;
  /** Set by the driver when publishing. */
  readonly at?: string;
}

export interface SubscribeOptions {
  /** This subscriber's origin id; events it published are suppressed. */
  readonly origin?: string;
}

export interface Subscription {
  unsubscribe(): Promise<void>;
}

export interface Realtime {
  publish(channel: string, event: RealtimeEvent): Promise<void>;

  subscribe(
    channel: string,
    handler: (event: RealtimeEvent) => void,
    options?: SubscribeOptions,
  ): Promise<Subscription>;

  stop(): Promise<void>;
}

/**
 * Postgres caps a NOTIFY payload at 8000 bytes. Events are meant to be
 * compact hints, so hitting this means the wrong thing is being sent.
 */
export const MAX_EVENT_BYTES = 8000;

export class EventTooLargeError extends Error {
  override readonly name = "EventTooLargeError";
  /**
   * Declared, not a parameter property.
   *
   * Every entry point in this repository runs under Node's
   * `--experimental-strip-types`, which erases types without transpiling and
   * refuses `constructor(readonly bytes: number)` outright. Vitest transpiles,
   * so 153 tests passed and only running `pnpm import:flowyteam` found it: the
   * importer imports this package's barrel for the storage driver at P6-T04c,
   * and the barrel loads this file. The same trap caught
   * `mappers/reconcile.ts` at P6-T04a, which is why the note is here too.
   */
  readonly bytes: number;

  constructor(bytes: number) {
    super(
      `Realtime event is ${bytes} bytes, over the ${MAX_EVENT_BYTES} byte limit. ` +
        `Events carry identifiers and counts; the client refetches the data.`,
    );
    this.bytes = bytes;
  }
}
