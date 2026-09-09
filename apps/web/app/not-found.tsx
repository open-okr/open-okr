import { buttonVariants, Card, CardBody } from "@openokr/ui";
import { SearchX } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "../lib/translations";

/**
 * The permission-denied state, wearing not-found's clothes (UIUX-PLAN.md
 * §4: "Empty states: icon, one sentence, primary action").
 *
 * A forbidden read collapses to not-found (§8.1 layer 2), so this page answers
 * both "there is no such workspace" and "there is one, but it is not yours".
 * Telling those apart would make the interface an oracle for what exists,
 * which is exactly what the access layer refuses to be.
 *
 * Rendered standalone, not inside the app shell, for the same reason as
 * `error.tsx`: the thing that resolved not-found may itself have been a
 * workspace lookup, so there is nothing to assume a shell around.
 */
export default async function NotFound() {
  const { t } = await getTranslations();

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4.5">
      <Card className="max-w-sm">
        <CardBody className="flex flex-col items-center gap-3 text-center">
          <SearchX className="size-8 text-ink-4" aria-hidden="true" />
          <h1 className="text-lg font-bold text-ink">
            {t("notFound.notFound")}
          </h1>
          <p className="text-sm text-ink-3">{t("notFound.weCouldNotFind")}</p>
          <Link href="/" className={buttonVariants({ variant: "primary" })}>
            {t("notFound.backToYourWorkspace")}
          </Link>
        </CardBody>
      </Card>
    </main>
  );
}
