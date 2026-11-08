-- AI credits (docs/design/ai-credits.md §4).
--
-- A credit is spent only on the provider's own key, so a usage row has to say whose
-- key paid. Nullable, because earlier rows do not know, and they spend nothing.
ALTER TABLE ai_usage_events
  ADD COLUMN key_source text
  CHECK (key_source IS NULL OR key_source IN ('user', 'workspace', 'deployment'));

-- One row per workspace rather than a sum over the usage table: the check runs before
-- every AI call, and one locked row is both faster and exact under concurrency. The
-- usage events stay as the record, and this can be rebuilt from them.
--
-- Amounts are model cost in US dollars, because the price list is, whatever currency
-- a provider sells in. What a credit is worth is an instance setting, so a provider
-- changing it does not rewrite this table.
--
-- openokr:hard-delete: one running total per workspace, which is reset rather than
-- removed, and goes when the workspace does.
CREATE TABLE ai_credit_balances (
  workspace_id   uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  period_start   date NOT NULL,
  used_usd       numeric(14, 6) NOT NULL DEFAULT 0 CHECK (used_usd >= 0),
  agent_used_usd numeric(14, 6) NOT NULL DEFAULT 0 CHECK (agent_used_usd >= 0),
  -- Survives a new month, because somebody paid for it.
  purchased_usd  numeric(14, 6) NOT NULL DEFAULT 0 CHECK (purchased_usd >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_credit_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_credit_balances FORCE ROW LEVEL SECURITY;

CREATE POLICY ai_credit_balances_tenant ON ai_credit_balances
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);
