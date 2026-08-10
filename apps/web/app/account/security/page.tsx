import { requireSession } from "../../../lib/session";
import { SecuritySettings } from "./security-settings";
import { Sessions } from "./sessions";

/**
 * A protected page: `requireSession` redirects a signed-out visitor to sign
 * in rather than rendering a shell that assumes a user.
 */
export default async function SecurityPage() {
  const session = await requireSession();

  return (
    <main style={{ maxWidth: "32rem", margin: "3rem auto", padding: "0 1rem" }}>
      <h1>Security</h1>
      <p>Signed in as {session.user.email}</p>
      <SecuritySettings
        twoFactorEnabled={session.user.twoFactorEnabled === true}
      />
      <Sessions />
    </main>
  );
}
