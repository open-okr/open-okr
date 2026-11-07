-- Billing (docs/design/billing.md §4).
--
-- Named for any provider rather than for Stripe: another one is a new driver and
-- needs no migration. Both tables exist everywhere and hold no rows until a
-- provider turns billing on, as `tenants` does.
--
-- Vendor knowledge, like `tenants`, so `pnpm check:boundaries` refuses a read from a
-- product path, and neither leaves in a workspace export.

CREATE TABLE billing_accounts (
  workspace_id         uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  provider             text NOT NULL,
  customer_ref         text NOT NULL,
  subscription_ref     text,
  -- The provider's own word, stored as text: its vocabulary is not ours to pin.
  status               text,
  current_period_end   timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  -- So a billing event never lifts a suspension an operator imposed.
  suspended_by_billing boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  CONSTRAINT billing_accounts_customer_unique UNIQUE (provider, customer_ref)
);

ALTER TABLE billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_accounts FORCE ROW LEVEL SECURITY;

CREATE POLICY billing_accounts_tenant ON billing_accounts
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- S-46 shows an operator the status and the customer reference. Reads only: a
-- change arrives from the webhook, under the workspace's own setting.
CREATE POLICY billing_accounts_operator_read ON billing_accounts
  FOR SELECT
  USING (app_is_live_operator());

-- What makes a repeated delivery do nothing.
-- openokr:hard-delete: a row here only ever says that an event was received, and
-- removing it would let the event apply twice, so there is nothing to soft-delete.
CREATE TABLE billing_events (
  provider     text NOT NULL,
  event_ref    text NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_ref)
);

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events FORCE ROW LEVEL SECURITY;

CREATE POLICY billing_events_tenant ON billing_events
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

CREATE INDEX billing_events_workspace_idx ON billing_events (workspace_id);
