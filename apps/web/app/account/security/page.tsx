import { Card, CardBody, CardHeader } from "@openokr/ui";
import { AppShellLayout } from "../../../lib/app-shell.tsx";
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
    <AppShellLayout>
      <div className="mx-auto flex max-w-xl flex-col gap-4.5">
        <Card>
          <CardHeader>
            <h1 className="text-lg font-bold text-ink">Security</h1>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-ink-3">
              Signed in as {session.user.email}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <SecuritySettings
              twoFactorEnabled={session.user.twoFactorEnabled === true}
            />
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Sessions />
          </CardBody>
        </Card>
      </div>
    </AppShellLayout>
  );
}
