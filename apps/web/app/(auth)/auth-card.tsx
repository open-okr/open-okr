import type { ReactNode } from "react";

/**
 * The single clean card every authentication screen sits in (screen S-35).
 *
 * Deliberately plain: the design system, its tokens and the string
 * catalogues arrive with P2-T10, and this screen is restyled there. What is
 * here now is the behaviour and the semantics — landmarks, labels, focus
 * order and error wiring — because those are what the rest of the task
 * depends on and what a later restyle should not have to reinvent.
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
    <main
      style={{
        maxWidth: "24rem",
        margin: "4rem auto",
        padding: "2rem",
        border: "1px solid #d4d4d8",
        borderRadius: "0.5rem",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: "1.25rem", marginTop: 0 }}>{title}</h1>
      {description ? <p style={{ color: "#52525b" }}>{description}</p> : null}
      {children}
      {footer ? (
        <footer style={{ marginTop: "1.5rem", fontSize: "0.875rem" }}>
          {footer}
        </footer>
      ) : null}
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
    <p role="alert" style={{ color: "#b91c1c", marginTop: "0.75rem" }}>
      {children}
    </p>
  );
}

export function Field({
  label,
  ...input
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = `field-${input.name}`;
  return (
    <p>
      <label htmlFor={id} style={{ display: "block", marginBottom: "0.25rem" }}>
        {label}
      </label>
      <input
        id={id}
        style={{ width: "100%", padding: "0.5rem", boxSizing: "border-box" }}
        {...input}
      />
    </p>
  );
}
