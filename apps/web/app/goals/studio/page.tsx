import { redirect } from "next/navigation";

/**
 * The alignment studio's old address (UIUX-PLAN.md S-16, P9-T09b).
 *
 * The studio is the OKRs screen's diagram now, with its health and review
 * panel beside the canvas, its link mode on the toolbar, and its details in
 * the drawer. A bookmark or a link in an old message still points here, so
 * this sends it to the same cycle on the diagram rather than to a page that
 * no longer exists.
 */
export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string }>;
}) {
  const { cycle } = await searchParams;
  const query = new URLSearchParams({ display: "diagram" });
  if (cycle) {
    query.set("cycle", cycle);
  }
  redirect(`/goals?${query.toString()}`);
}
