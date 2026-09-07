import { Card, CardBody } from "@openokr/ui";
import type { InputHTMLAttributes, ReactNode } from "react";

/**
 * The single clean card every authentication screen sits in (screen S-35,
 * restyled P2-T10). §3: "A single clean card with workspace branding and a
 * pre-authentication language switcher." Workspace branding and the
 * language switcher are not built here — no branding colour reaches an
 * unauthenticated request yet (S-36's branding card writes a workspace
 * setting no sign-in-time code reads), and the language switcher needs a
 * resolved instance/workspace default this route does not look up today —
 * both flagged in STATUS.md rather than invented.
 *
 * JavaScript stays required for every screen this wraps: this task's own
 * "decide progressive enhancement" note is answered here. Passkey sign-in
 * is one of the offered methods (§4.4), and WebAuthn has no server-only
 * fallback at all — the ceremony is `navigator.credentials`, which cannot
 * run without JavaScript on any browser. A parallel no-JS path for
 * password-only sign-in would mean two divergent flows to keep in sync for
 * a case (a modern browser with JavaScript disabled) that is vanishingly
 * rare next to "no WebAuthn support," which the JS-required path already
 * handles by falling back to a password.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4.5">
      <Card className="w-full max-w-sm">
        <CardBody className="flex flex-col gap-1">
          <h1 className="text-lg font-bold text-ink">{title}</h1>
          {description ? (
            <p className="text-sm text-ink-3">{description}</p>
          ) : null}
          <div className="mt-3 flex flex-col gap-3">{children}</div>
          {footer ? (
            <footer className="mt-4 text-sm text-ink-3">{footer}</footer>
          ) : null}
        </CardBody>
      </Card>
    </main>
  );
}

/**
 * An error the user can act on. `role="alert"` so it is announced rather
 * than silently appearing, which is the difference between an accessible
 * form and one that merely looks complete.
 */
export function FormError({ children }: { children: ReactNode }) {
  if (!children) {
    return null;
  }
  return (
    <p role="alert" className="text-sm font-medium text-bad">
      {children}
    </p>
  );
}

/**
 * The one input skin every authentication field wears. Exported so a field
 * that has to build its own input (the password reveal in
 * `password-field.tsx`) cannot drift from this one.
 */
export const fieldInputClass =
  "h-7.5 w-full rounded-control border border-line-2 bg-surface px-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand-line";

export function Field({
  label,
  className,
  ...input
}: {
  label: string;
  className?: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  const id = `field-${input.name}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-ink-2">
        {label}
      </label>
      <input id={id} className={fieldInputClass} {...input} />
    </div>
  );
}
