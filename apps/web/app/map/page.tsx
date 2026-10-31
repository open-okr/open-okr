import { AreaTabs } from "../../lib/area-tabs.tsx";
import { getTranslations } from "../../lib/translations";
import { WorkMapScreen } from "../work-map-screen.tsx";

/**
 * The company tree, the Map tab of Goals (OKRGoal UX review, backlog 12):
 * "Company tree moves to Goals." Every member reaches it here; Home is now
 * each reader's own week.
 */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ node?: string; cycle?: string; scope?: string }>;
}) {
  const { t } = await getTranslations();
  return (
    <>
      <AreaTabs area="goals" current="/map" t={t} />
      <div className="flex w-full flex-col gap-3.5">
        <WorkMapScreen query={await searchParams} basePath="/map" />
      </div>
    </>
  );
}
