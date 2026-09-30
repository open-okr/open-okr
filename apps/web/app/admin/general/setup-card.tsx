import { Button, Card, CardBody, CardHeader } from "@openokr/ui";
import Link from "next/link";
import { getTranslations } from "../../../lib/translations";
import { ActionForm } from "../../cycle/action-form.tsx";
import { reopenSetup } from "./setup-actions.ts";

/**
 * The workspace's own setup, offered again (UIUX-PLAN S-34, completeness
 * review L-08).
 *
 * **"A dismissed onboarding is resumable from admin", and there was nowhere to
 * resume it.** An owner who skipped every step on the first day, which §4.14
 * says is a first-class answer, met a wizard that refused to reappear and no
 * control that could change its mind.
 *
 * **Two states, and each offers the one thing that makes sense.** A finished
 * setup offers to open it again, which is a write and is audited. A pending
 * one, which is what a reopened setup is until somebody finishes it, links
 * straight to the wizard rather than writing the same flag a second time.
 *
 * **Nothing here resets an answer.** Reopening flips one flag; the wizard
 * opens on what the workspace holds now, so skipping a step keeps it.
 */
export async function SetupCard({ done }: { readonly done: boolean }) {
  const { t } = await getTranslations();

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-sm font-bold text-ink">
            {t("admin.setup.title")}
          </h2>
          <p className="text-xs text-ink-3">{t("admin.setup.explains")}</p>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <p className="text-sm text-ink-2" data-testid="setup-state">
          {done ? t("admin.setup.saysDone") : t("admin.setup.saysPending")}
        </p>
        {done ? (
          <ActionForm action={reopenSetup} className="flex flex-col">
            <div>
              <Button type="submit" size="sm" data-testid="reopen-onboarding">
                {t("admin.setup.reopen")}
              </Button>
            </div>
          </ActionForm>
        ) : (
          <div>
            <Link
              href="/welcome"
              data-testid="continue-onboarding"
              className="text-sm font-semibold text-brand-text underline"
            >
              {t("admin.setup.continue")}
            </Link>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
