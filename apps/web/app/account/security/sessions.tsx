import { listUserSessions, type UserSession } from "@openokr/core";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getAuth } from "../../../lib/auth";

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
  let sessions: UserSession[] | null = null;
  try {
    sessions = await listUserSessions(getAuth(), userId);
  } catch {
    // The rest of the page is about staying safe, so it has to render even
    // when this one list cannot be read.
    sessions = null;
  }

  return (
    <section style={{ fontFamily: "system-ui, sans-serif" }}>
      <h2>Sessions</h2>
      <p>
        Every device currently signed in. Revoking one signs it out immediately.
      </p>
      {sessions === null ? (
        <p role="status">
          This list could not be read just now. Reload the page to try again.
        </p>
      ) : sessions.length === 0 ? (
        <p>No other device is signed in.</p>
      ) : (
        <ul>
          {sessions.map((session) => (
            <li key={session.id}>
              {session.userAgent ?? "Unknown device"}
              {session.ipAddress ? ` (${session.ipAddress})` : ""}
              {", since "}
              {session.createdAt.toLocaleString()}{" "}
              <form action={revoke} style={{ display: "inline" }}>
                <input type="hidden" name="token" value={session.token} />
                <button type="submit">Revoke</button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
