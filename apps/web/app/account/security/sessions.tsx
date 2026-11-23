import { listUserSessions, type UserSession } from "@openokr/core";
import { intlTagFor } from "@openokr/formats";
import { Button, Card, CardBody, CardHeader } from "@openokr/ui";
import { Laptop, Smartphone } from "lucide-react";
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
 * carries the full reasoning. Revoking still goes through the endpoint, from
 * the server through `auth.api`, which asks only that the session be real,
 * and checks the token belongs to the caller before it deletes anything. Its
 * HTTP path is off (docs/design/account-self-service.md §3), and a server
 * call never meets that list.
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
  const { t, locale } = await getTranslations();

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
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-ink">
              {t("common.sessions")}
            </h2>
            {sessions === null ? null : (
              <span className="rounded-full bg-raised px-2 font-semibold text-ink-3 text-xs">
                {sessions.length}
              </span>
            )}
          </div>
          <p className="text-xs text-ink-3">
            {t("account.security.sessions.everyDeviceCurrentlySigned")}
          </p>
        </div>
      </CardHeader>
      <CardBody>
        {sessions === null ? (
          <p role="status" className="text-sm text-ink-3">
            {t("account.security.sessions.thisListCouldNot")}
          </p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-ink-3">
            {t("account.security.sessions.noOtherDeviceIs")}
          </p>
        ) : (
          // Scrolls inside the card at about five rows; tabIndex lets a
          // keyboard user scroll it.
          <ul
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll region must be focusable to scroll by keyboard
            tabIndex={0}
            aria-label={t("account.security.sessions.listLabel")}
            className="max-h-[296px] overflow-y-auto pe-1.5 overscroll-contain rounded-lg border border-line"
          >
            {sessions.map((session, index) => {
              const device = session.userAgent ?? "";
              const Icon = /Mobile|iPhone|Android/i.test(device)
                ? Smartphone
                : Laptop;
              return (
                <li
                  key={session.id}
                  className={`flex items-center gap-3 px-3 py-2.5 ${index === 0 ? "" : "border-line border-t"}`}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-ink-3">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span
                      className="truncate text-sm font-medium text-ink"
                      title={
                        session.userAgent ??
                        t("account.security.sessions.unknownDevice")
                      }
                    >
                      {session.userAgent ??
                        t("account.security.sessions.unknownDevice")}
                    </span>
                    <span className="text-xs text-ink-3">
                      {[
                        session.ipAddress,
                        session.createdAt.toLocaleString(intlTagFor(locale)),
                      ]
                        .filter((one) => one)
                        .join(" · ")}
                    </span>
                  </span>
                  <form action={revoke}>
                    <input type="hidden" name="token" value={session.token} />
                    <Button type="submit" size="sm">
                      {t("common.revoke")}
                    </Button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
