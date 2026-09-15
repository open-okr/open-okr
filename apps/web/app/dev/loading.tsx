import { SegmentLoading } from "../../lib/segment-loading.tsx";

/**
 * The component preview pages' loading state (P8-G01).
 *
 * **This is the one Agung reported, and it is the reason the rule got
 * split.** Both dev pages are full-width columns with no shell and no
 * centred card, so they take `SegmentLoading` rather than the centred shape
 * the authentication screens use.
 *
 * They are exempt from the error-boundary rule, because they are
 * development-only and `notFound()` in production, and the first reading of
 * this gap assumed the loading rule inherited that exemption. It does not.
 * In development Turbopack compiles a route the first time somebody asks for
 * it, so this is exactly where a navigation sits longest with nothing moving,
 * and a page nobody serves in production is still a page somebody waits on
 * every working day.
 */
export default function Loading() {
  return <SegmentLoading />;
}
