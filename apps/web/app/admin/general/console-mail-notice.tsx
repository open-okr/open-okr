/**
 * Tells an operator their instance is still writing every message to the log
 * (P7-T08d).
 *
 * **The console mail driver is the right default and the wrong long-term
 * state.** `mail.transport` defaults to `console`, which is what lets a
 * fresh checkout run the first-run wizard and click an invitation link with
 * no mail server anywhere. That driver writes each message to stdout: the
 * recipient's address, the subject and the body. So an instance still on it
 * a month later is logging every invitation, every digest and every
 * password reset, with the address of the person it was for, into logs that
 * are usually shipped somewhere.
 *
 * The P7-T08a privacy review found nothing anywhere that says so. The driver
 * is doing its job; the gap was that an operator could run like this for a
 * quarter and never be told.
 *
 * **It appears on this screen because there is no mail screen.** Mail is
 * configured by setting and by environment and has no surface of its own,
 * which is its own small finding. This is the instance settings screen, so
 * this is where an instance-level warning belongs until one exists.
 */
export function ConsoleMailNotice() {
  return (
    <section className="rounded-md border border-warn/30 bg-warn/5 p-4.5">
      <h2 className="text-sm font-bold text-warn">
        Every message is going to the log, not to anybody
      </h2>
      <p className="mt-1.5 text-sm text-ink-muted">
        This instance has no mail server configured, so it is using the console
        driver. That driver writes each message to the process log with the
        recipient&rsquo;s address, the subject and the body. Nothing is being
        delivered: invitations, weekly digests and password-reset links are all
        sitting in the log instead.
      </p>
      <p className="mt-1.5 text-sm text-ink-muted">
        Set <code className="font-mono text-xs">mail.transport</code> to{" "}
        <code className="font-mono text-xs">smtp</code> and give it a host, a
        user and a password. A password-reset link in a log is a credential:
        anyone who can read the log can take the account it belongs to.
      </p>
    </section>
  );
}
