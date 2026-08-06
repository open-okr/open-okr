import Link from "next/link";

/**
 * The permission-denied state, wearing not-found's clothes.
 *
 * A forbidden read collapses to not-found (§8.1 layer 2), so this page answers
 * both "there is no such workspace" and "there is one, but it is not yours".
 * Telling those apart would make the interface an oracle for what exists,
 * which is exactly what the access layer refuses to be.
 */
export default function NotFound() {
  return (
    <main style={{ maxWidth: "32rem", margin: "3rem auto", padding: "0 1rem" }}>
      <h1>Not found</h1>
      <p>
        We could not find that, or it is not yours to see. If you were expecting
        access, ask a workspace admin to invite you.
      </p>
      <p>
        <Link href="/">Back to your workspace</Link>
      </p>
    </main>
  );
}
