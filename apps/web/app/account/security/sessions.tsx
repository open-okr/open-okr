import { listUserSessions, type UserSession } from "@openokr/core";
import { Button, Card, CardBody, CardHeader } from "@openokr/ui";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getAuth } from "../../../lib/auth";
import { getTranslations } from "../../../lib/translations";

/**
 * The session list with revoke (TECHNICAL-PLAN §8.2, P2-T09).
 *
 * A server action rather than the browser SDK: consistent with how every
 * other write on this page's neighbours works (`rename-workspace.tsx`,
 * `general-settings-form.tsx`), and it means this list needs no client
 * bundle of its own.
 *
 * The read goes through `listUserSessions` rather than Better Auth's
 * `/list-sessions` endpoint, which refuses any session over a day old and so
 * made this page fail for most of a session's thirty-day life. That function
 * carries the full reasoning. Revoking still goes through the endpoint, which
 * asks only that the session be real, and checks the token belongs to the
 * caller before it deletes anything.
 *
 * **A row per device rather than a run-on sentence.** The list was a bare
 * `<ul>` whose every item ran the user agent, the address, the date and an
 * unstyled Revoke button together on one line, so the longest string on the
 * page was the thing hardest to read. The device leads, the address and the
 * start time sit under it, and the control that ends the session is on the
 * right where the other lists in this product put it.
 */

async function revoke(formData: FormData): Promise<void> {
  "use server";
  const token = String(formData.get("token") ?? "");
  if (token === "") {
    return;
  }
  await getAuth().api.revokeSession({
    headers: await headers(),
    body: { token },
  });
  revalidatePath("/account/security");
}

export async function Sessions({ userId }: { userId: string }) {
  const { t } = await getTranslations();

  let sessions: UserSession[] | null = null;
  try {
    sessions = await listUserSessions(getAuth(), userId);
  } catch {
    // The rest of the page is about staying safe, so it has to render even
    // when this one list cannot be read.
    sessions = null;
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-bold text-ink">{t("common.sessions")}</h2>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <p className="max-w-prose text-sm text-ink-3">
          {t("account.security.sessions.everyDeviceCurrentlySigned")}
        </p>
        {sessions === null ? (
          <p role="status" className="text-sm text-ink-3">
            {t("account.security.sessions.thisListCouldNot")}
          </p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-ink-3">
            {t("account.security.sessions.noOtherDeviceIs")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((session) => (
              <li
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="break-all text-sm font-medium text-ink">
                    {session.userAgent ?? "Unknown device"}
                  </span>
                  <span className="text-xs text-ink-3">
                    {[session.ipAddress, session.createdAt.toLocaleString()]
                      .filter((one) => one)
                      .join(" · ")}
                  </span>
                </span>
                <form action={revoke}>
                  <input type="hidden" name="token" value={session.token} />
                  <Button type="submit" variant="ghost" size="sm">
                    {t("common.revoke")}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
