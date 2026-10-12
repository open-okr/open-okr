-- The tenant record (TECHNICAL-PLAN §4.13, P8-T02a).
--
-- Design: docs/design/p8-t01a-tenant-lifecycle.md.
--
-- Cloud only, and absent on every self-hosted instance. The table exists
-- everywhere and holds no rows there, because one migration path for
-- everybody is simpler than a conditional one.
--
-- The primary key is the workspace id rather than an id of its own. One
-- tenant per workspace is the rule, and a key enforces it without a second
-- unique index on a column nobody reads.
--
-- What is deliberately NOT here: anything the product needs in order to run
-- an OKR practice. A plan, a seat count and a region are facts the vendor
-- knows about a customer. The moment a goal list reads plan_key, self-host
-- and cloud have forked. `pnpm check:boundaries` refuses that read.

CREATE TABLE tenants (
  workspace_id   uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  state          text NOT NULL DEFAULT 'active'
                 CHECK (state IN ('active', 'suspended', 'closed')),
  -- Null is the free tier, so the free tier needs no catalogue row. Text
  -- rather than an enum: a plan is a row in `cloud.plans`, and an enum would
  -- turn adding a plan into a migration.
  plan_key       text,
  -- Null means unlimited.
  seats          integer CHECK (seats IS NULL OR seats >= 0),
  trial_ends_at  timestamptz,
  -- Recorded, never routed on. A residency claim is a contract, not a
  -- column, and backfilling this later would mean guessing.
  region         text NOT NULL,
  -- Stamped when state becomes 'closed'. The retention clock reads it.
  closed_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  -- A closed tenant has a closure instant and an open one does not. Without
  -- this, a retention sweep reading closed_at would skip a closed workspace
  -- whose stamp was forgotten, which is the failure that looks like nothing
  -- happening.
  CONSTRAINT tenants_closed_at_matches_state
    CHECK ((state = 'closed') = (closed_at IS NOT NULL))
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

-- The tenant floor, exactly as every other business table has it. Being
-- cloud-only is not an exemption: a workspace reads its own row so a seat
-- count can reach the customer's own screen, and the floor is what stops it
-- reading anybody else's. The operator's read past this floor is P8-T03 and
-- arrives as a second, narrow policy rather than as a loosening of this one.
CREATE POLICY tenants_tenant ON tenants
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

-- Closed workspaces past their retention window, for the P8-T02c sweep.
-- Partial, because the sweep only ever asks about closed ones and an index
-- over every tenant would be mostly dead weight.
CREATE INDEX tenants_closed_at_idx
  ON tenants (closed_at)
  WHERE state = 'closed' AND deleted_at IS NULL;
