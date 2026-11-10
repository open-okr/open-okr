/**
 * The fake error tracker the suite's application server reports to
 * (docs/design/error-reporting.md §6, plan 0.7.0 E3).
 *
 * **The DSN is the deployment's, read once at boot**, so unlike the mail
 * catcher in `hosting.ts` it cannot be pointed somewhere per spec: the server
 * is started with this one, and `error-reporting.spec.ts` listens on its port
 * for its own length. While nothing listens, a report finds the port closed,
 * is counted as dropped, and no spec notices, which is the driver doing what
 * D10 says.
 *
 * `localhost` rather than `127.0.0.1` on purpose: the spec asserts the
 * tracker's host never appears in a page, and every page names `127.0.0.1`
 * because that is the instance's own address.
 */
export const TRACKER_PORT = Number(process.env.E2E_TRACKER_PORT ?? 3212);

/** Distinctive, so its absence from a page means something. */
export const TRACKER_KEY = "e2etrackerpublickey0000000000000";

export const TRACKER_DSN = `http://${TRACKER_KEY}@localhost:${TRACKER_PORT}/1`;
