import { readSetupState, setupRefusal } from "@openokr/core";
import { buttonVariants, Card, CardBody, cn } from "@openokr/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { getPool } from "../../lib/auth";

/**
 * The first-run wizard's shell, and its lock (P1-T09, restyled P2-T10 on
 * direct request — S-34 is a later phase's screen, but the wizard is the
 * very first thing anyone running this instance sees, and the mockups'
 * own card-and-token language reads better here than the unstyled
 * original).
 *
 * Every setup route sits under this layout, so the "is this instance already
 * configured" question is asked once, in one place, for all of them. A guard
 * repeated per page is a guard that will eventually be forgotten on a page.
 *
 * The check runs on every request rather than being cached. It is one indexed
 * lookup, and the failure mode of a stale cache here is an open setup wizard
 * on a live instance.
 */
export const dynamic = "force-dynamic";

export default async function SetupLayout({
  children,
}: {
  children: ReactNode;
}) {
  const state = await readSetupState(getPool());
  const refusal = setupRefusal(state);

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4.5">
      <Card className="w-full max-w-lg">
        <CardBody className="flex flex-col gap-3">
          {refusal ? (
            <>
              <h1 className="text-lg font-bold text-ink">
                Setup is already done
              </h1>
              <p className="text-sm text-ink-3">{refusal}</p>
              <Link
                href="/"
                className={cn(
                  buttonVariants({ variant: "primary" }),
                  "self-start",
                )}
              >
                Go to the instance
              </Link>
            </>
          ) : (
            children
          )}
        </CardBody>
      </Card>
    </main>
  );
}
