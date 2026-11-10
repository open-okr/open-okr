-- The trial sweep (docs/design/tenant-lifecycle.md §11, plan 0.7.0 P4,
-- approved by Akmal on 9 November 2026).
--
-- `suspended_by_trial` marks a workspace the sweep made read-only because its
-- people do not fit the default plan its trial ended on. It does for a trial
-- what `billing_accounts.suspended_by_billing` does for a subscription, on the
-- tenant row, because a trial with no card has no billing account. Read only
-- while the tenant is suspended, and cleared on every lifecycle move.
--
-- `trial_reminded_at` is when the owners and administrators were told the
-- trial ends in seven days (§11 Q2), so they are told once. Cleared whenever
-- the end date moves.
--
-- No check constraint, on purpose: a replica of the previous release moving
-- the tenant during a rolling upgrade knows neither column and must not fail.
-- Forward-only and additive; nothing changes until somebody sets a trial.
alter table tenants
add column suspended_by_trial boolean not null default false;

alter table tenants add column trial_reminded_at timestamptz;
