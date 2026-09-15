-- Who the operator was, on the workspace's own audit trail (P8-T03b).
--
-- `audit_events.actor_kind` has carried 'operator' as a permitted value since
-- the table was created, and `ActorInput` in the Operation pipeline has
-- carried the same kind, and neither has ever had anything to point at. An
-- operator is not a member of the workspace they are acting on, so
-- `actor_member_id` is null for them and the row would say only that
-- somebody outside did something.
--
-- **The customer has to be able to see who.** A support action that reads as
-- the workspace's own is a falsified record, and a suspension a customer
-- cannot see attributed is one they have to take on trust.
--
-- No expand-then-contract dance is needed: `actor_member_id` is already
-- nullable, so this only adds. The append-only trigger from 0080 is
-- unaffected, because adding a column is not an update to a row.

-- openokr:not-tenant-scoped: this adds a column to an existing table and
-- creates none, so the tenant-floor and soft-delete checks have nothing to
-- read here.
ALTER TABLE audit_events
  ADD COLUMN actor_operator_user_id text
    REFERENCES users(id) ON DELETE SET NULL;

-- Finding every action one operator took, which is what an auditor asks for
-- and what the workspace's own audit screen filters by.
CREATE INDEX audit_events_operator_idx
  ON audit_events (actor_operator_user_id, at DESC)
  WHERE actor_operator_user_id IS NOT NULL;

COMMENT ON COLUMN audit_events.actor_operator_user_id IS
  'The cloud operator who acted, when actor_kind is ''operator''. Null for every other kind. An operator is not a member, so actor_member_id is null for them.';
