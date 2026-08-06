import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "../lib/auth";

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
      <button type="submit">Sign out</button>
    </form>
  );
}
