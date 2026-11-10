-- Three inbox reasons (release 0.7.0).
--
-- `support_request` and `support_ended` (docs/design/support-access.md §10,
-- plan P2): the administrators who can answer a support request hear that one
-- was made, and that a session ended. A row written inside an Operation has no
-- activity to point at, so its reason alone decides what its line says, which
-- is why a request and an end are two reasons rather than one.
--
-- `connection_ended` (docs/design/agent-connections-admin.md, plan A4): a
-- member hears that an administrator ended their agent connection or token.
-- In this migration rather than its own, because both widen the same two
-- checks and dropping and re-adding them twice in one release is churn.
--
-- `subscriptions` is widened too so the one reason enum in the schema matches
-- both tables; nothing writes a subscription with these reasons.
--
-- Forward-only and safe for a rolling upgrade: each check gains values the
-- previous release never writes, and no row changes.
alter table notifications
drop constraint if exists notifications_reason_check;

alter table notifications
add constraint notifications_reason_check check (
  reason in (
    'invited',
    'joined',
    'mentioned',
    'role',
    'review',
    'check_in',
    'support_request',
    'support_ended',
    'connection_ended'
  )
);

alter table subscriptions
drop constraint if exists subscriptions_reason_check;

alter table subscriptions
add constraint subscriptions_reason_check check (
  reason in (
    'invited',
    'joined',
    'mentioned',
    'role',
    'review',
    'check_in',
    'support_request',
    'support_ended',
    'connection_ended'
  )
);
