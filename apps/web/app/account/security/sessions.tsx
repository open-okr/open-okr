import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getAuth } from "../../../lib/auth";

/**
 * The session list with revoke (TECHNICAL-PLAN §8.2, P2-T09).
 *
 * A server action rather than the browser SDK: consistent with how every
 * other write on this page's neighbours works (`rename-workspace.tsx`,
 * `general-settings-form.tsx`), and it means this list needs no client
 * bundle of its own. `auth.api.listSessions`/`revokeSession` are Better
 * Auth's own core endpoints — no plugin, no migration — reached the same
 * way `getCurrentSession` already reaches `auth.api.getSession`.
 */

interface SessionRow {
  readonly token: string;
  readonly createdAt: string | Date;
  readonly userAgent?: string | null;
  readonly ipAddress?: string | null;
}

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

export async function Sessions() {
  const requestHeaders = await headers();
  const sessions = (await getAuth().api.listSessions({
    headers: requestHeaders,
  })) as SessionRow[];

  return (
    <section style={{ fontFamily: "system-ui, sans-serif" }}>
      <h2>Sessions</h2>
      <p>
        Every device currently signed in. Revoking one signs it out immediately.
      </p>
      <ul>
        {sessions.map((session) => (
          <li key={session.token}>
            {session.userAgent ?? "Unknown device"}
            {session.ipAddress ? ` — ${session.ipAddress}` : ""}
            {" — since "}
            {new Date(session.createdAt).toLocaleString()}{" "}
            <form action={revoke} style={{ display: "inline" }}>
              <input type="hidden" name="token" value={session.token} />
              <button type="submit">Revoke</button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
