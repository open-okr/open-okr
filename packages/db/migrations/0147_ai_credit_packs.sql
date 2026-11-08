-- Purchased AI credits expire (docs/design/ai-credits.md §4 and §6).
--
-- One row per purchase rather than one total, because two packs bought months apart
-- expire on different days, and one number cannot say how much of it lapses when.
--
-- Nothing runs when a pack lapses. Every read compares `expires_at` with the time,
-- so a lapsed pack stops counting at that instant, no job can fail or run late, and
-- the row stays as the record of what lapsed.
--
-- A charge holds the balance row's lock (migration 0146) before it touches a pack, so
-- the packs need no lock of their own.
--
-- openokr:hard-delete: a ledger of what was bought and what is left of it. A spent or
-- lapsed pack keeps its row, and the rows go when the workspace does.
CREATE TABLE ai_credit_packs (
  id            uuid PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  credits       integer NOT NULL CHECK (credits > 0),
  -- Model cost in US dollars, at the credit value on the day it landed, like the
  -- balance. A provider changing that value later does not reprice a pack sold.
  purchased_usd numeric(14, 6) NOT NULL CHECK (purchased_usd > 0),
  remaining_usd numeric(14, 6) NOT NULL
    CHECK (remaining_usd >= 0 AND remaining_usd <= purchased_usd),
  -- The provider's reference for the purchase: Stripe's checkout session. Unique, so
  -- one checkout is one pack whichever of its events arrives.
  purchase_ref  text NOT NULL,
  purchased_at  timestamptz NOT NULL,
  -- Fixed when the pack lands. A provider changing the length later moves only the
  -- packs sold after it.
  expires_at    timestamptz NOT NULL CHECK (expires_at > purchased_at),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_credit_packs_purchase_unique UNIQUE (workspace_id, purchase_ref)
);

ALTER TABLE ai_credit_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_credit_packs FORCE ROW LEVEL SECURITY;

CREATE POLICY ai_credit_packs_tenant ON ai_credit_packs
  USING (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

-- The charge and the check both read the live packs, soonest to lapse first.
CREATE INDEX ai_credit_packs_live_idx ON ai_credit_packs (workspace_id, expires_at)
  WHERE remaining_usd > 0;

-- The one total is replaced by the packs. Migration 0146 has shipped in no release,
-- so no running instance reads this column and no purchase needs carrying over: the
-- two-release rule protects a rolling upgrade, and there is none to protect.
-- openokr:replaces: no release; migration 0146 added this column and shipped in none, and ai_credit_packs above replaces it
ALTER TABLE ai_credit_balances DROP COLUMN purchased_usd;
