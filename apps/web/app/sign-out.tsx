import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "../lib/auth";
import { menuRowClass } from "./avatar-menu.tsx";

/**
 * Signing out.
 *
 * A server action rather than a form posting straight at the authentication
 * endpoint. That endpoint answers with JSON, which is right for a client
 * calling it and wrong for a browser submitting a form: without JavaScript the
 * person ended up looking at `{"success":true}` instead of the sign-in screen.
 *
 * Going through the action means one path for both, and the redirect happens
 * server-side after the session is actually revoked.
 */
async function signOut(): Promise<void> {
  "use server";

  const requestHeaders = await headers();
  // Better Auth revokes the session and clears the cookie; the nextCookies
  // plugin is what lets it do that from inside a server action.
  await getAuth().api.signOut({ headers: requestHeaders });
  redirect("/sign-in");
}

export function SignOut() {
  return (
    <form action={signOut}>
      {/* `menuRowClass` rather than a class list of its own: this button sits
       * directly under three menu rows, and an unstyled one inherited the
       * body's 16px next to their 13px. */}
      <button type="submit" className={menuRowClass}>
        Sign out
      </button>
    </form>
  );
}
