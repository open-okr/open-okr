import { Card, CardBody } from "@openokr/ui";
import Link from "next/link";
import { getTranslations } from "../../../lib/translations";

export default async function MemberNotFound() {
  const { t } = await getTranslations();

  return (
    <div className="flex flex-col gap-4.5">
      <Card>
        <CardBody className="flex flex-col items-start gap-3">
          <h1 className="text-base font-bold text-ink">
            {t("people.detail.notFound.memberNotFound")}
          </h1>
          <p className="text-sm text-ink-3">
            {t("people.detail.notFound.thisPersonDoesNot")}
          </p>
          <Link
            href="/people"
            className="text-sm font-semibold text-brand-text hover:underline"
          >
            {t("common.backToTheDirectory")}
          </Link>
        </CardBody>
      </Card>
    </div>
  );
}
