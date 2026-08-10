import { ACCESS_LEVELS, navigationFor } from "@openokr/core";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireAccessLevel } from "../../lib/access";

/**
 * The admin shell (screen S-36 skeleton, P2-T08).
 *
 * Two levels: this layout is the left-hand section navigation, and each
 * page under it is one card on the right with its own save. Gated once here
 * rather than in every page: a member below `full` never reaches anything
 * this layout wraps, which is the "route is denied" half of the P2-T08
 * acceptance criterion. `navigationFor` supplies the "item is hidden" half,
 * filtering the section list itself to what this member's own level
 * reaches — today that is every admin item, because every one of them
 * requires `full`, but a lower-requirement card added later is hidden here
 * without this file changing.
 *
 * Unstyled on purpose: the design system arrives at P2-T10.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const access = await requireAccessLevel(ACCESS_LEVELS.full);
  const sections = navigationFor("admin", access.level);

  return (
    <div
      style={{
        display: "flex",
        gap: "2rem",
        margin: "3rem auto",
        maxWidth: "48rem",
      }}
    >
      <nav style={{ minWidth: "10rem" }}>
        <h2>Admin</h2>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {sections.map((item) => (
            <li key={item.id}>
              <Link href={item.href}>{item.label}</Link>
            </li>
          ))}
        </ul>
        <p>
          <Link href="/">Back to workspace</Link>
        </p>
      </nav>
      <main style={{ flex: 1 }}>{children}</main>
    </div>
  );
}
