import Link from "next/link";
import { APP_NAME } from "../lib/app-info";
import { requireSession } from "../lib/session";

/**
 * The home route, now behind authentication. The dashboard that proves the
 * whole stack end to end arrives in P1-T08; this shows who is signed in and
 * the way to their security settings.
 */
export default async function HomePage() {
  const session = await requireSession();

  return (
    <main style={{ maxWidth: "32rem", margin: "3rem auto", padding: "0 1rem" }}>
      <h1>{APP_NAME}</h1>
      <p>Signed in as {session.user.name}.</p>
      <p>
        <Link href="/account/security">Security settings</Link>
      </p>
      <form method="post" action="/api/auth/sign-out">
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
