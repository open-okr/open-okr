import Link from "next/link";
import { APP_NAME } from "../lib/app-info";
import { requireWorkspace } from "../lib/workspace";
import { WorkspaceSwitcher } from "./workspace-switcher";

/**
 * The home route, behind authentication and now scoped to a workspace. The
 * dashboard that proves the whole stack end to end arrives in P1-T08; this
 * shows who is signed in, which workspace they are in, and the way out.
 */
export default async function HomePage() {
  const { session, workspace, memberships } = await requireWorkspace();

  return (
    <main style={{ maxWidth: "32rem", margin: "3rem auto", padding: "0 1rem" }}>
      <h1>{APP_NAME}</h1>
      <p>
        Signed in as {session.user.name}, in {workspace.name}.
      </p>
      <WorkspaceSwitcher memberships={memberships} active={workspace} />
      <p>
        <Link href="/account/security">Security settings</Link>
      </p>
      <form method="post" action="/api/auth/sign-out">
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
