"use client";

/**
 * The last boundary (P6-G24a).
 *
 * `error.tsx` at the root catches a page that throws. It cannot catch the root
 * layout itself, and the root layout does real work: it loads the environment
 * for `APP_BUILD_ID`, reads the request headers for the content-security nonce,
 * and mounts three providers. A throw in any of those left the browser with
 * Next's own unstyled default page, which names the framework and tells a
 * reader nothing.
 *
 * **It renders its own `html` and `body`, because it replaces the root layout
 * rather than sitting inside it.** That is Next's contract for this file, and
 * it is why the styling here is inline: the layout that imports `globals.css`
 * is the thing that failed, so no class name can be relied on.
 *
 * Deliberately plain. Whatever got here is a deployment fault, not a product
 * state, and the one useful thing is the digest that ties it to a log line.
 */
export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f6f8fb",
          color: "#1a2332",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <main
          style={{
            maxWidth: "26rem",
            padding: "1.5rem",
            background: "#ffffff",
            border: "1px solid #dbe2ec",
            borderRadius: "0.5rem",
          }}
        >
          <h1 style={{ fontSize: "1.125rem", margin: "0 0 0.5rem" }}>
            OpenOKR could not start
          </h1>
          <p style={{ fontSize: "0.875rem", margin: "0 0 1rem" }}>
            Something failed before any screen could be drawn. This is a fault
            in the deployment, not in anything you did.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              fontSize: "0.875rem",
              fontWeight: 600,
              padding: "0.5rem 0.75rem",
              borderRadius: "0.375rem",
              border: "none",
              background: "#4f46e5",
              color: "#ffffff",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p
              style={{
                fontSize: "0.75rem",
                margin: "1rem 0 0",
                color: "#5c6b80",
              }}
            >
              Reference: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
