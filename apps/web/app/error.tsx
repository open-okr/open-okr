"use client";

/**
 * The error state.
 *
 * A route-level boundary has to be a client component, because it takes a
 * reset callback. It deliberately shows nothing about what went wrong: the
 * message could name a table, a query or a workspace the reader may not know
 * exists. The digest is Next's own correlation id, which is safe to show and
 * is what ties a report here to a line in the server log.
 */
export default function HomeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main style={{ maxWidth: "32rem", margin: "3rem auto", padding: "0 1rem" }}>
      <h1>Something went wrong</h1>
      <p>
        We could not load your workspace. This is our fault, not something you
        did.
      </p>
      <button type="button" onClick={reset}>
        Try again
      </button>
      {error.digest ? (
        <p>
          <small>Reference: {error.digest}</small>
        </p>
      ) : null}
    </main>
  );
}
