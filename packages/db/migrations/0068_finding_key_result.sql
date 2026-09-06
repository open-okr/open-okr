-- A finding can name a key result, not only a goal (P5-T14).
--
-- **The identity is what this column changes, and that is the whole point.**
-- `reconcileFindingsInTx` keys a finding on (rule key, subject goal, target
-- goal), which is why the divergence sweep deliberately raised one finding per
-- goal: two on the same goal collided on one identity and the second overwrote
-- the first. A goal with three key results has three separate measures that can
-- each disagree with their own linked work, and each is a different
-- conversation. With the key result in the identity they coexist, and
-- dismissing one leaves the other two.
--
-- **`subject_goal_id` is still set on every one of them.** The key result is
-- additional, never a replacement: every existing reader of this table asks
-- about goals, and a finding that named only a key result would vanish from the
-- surfaces that already work. A linked-work finding names both.
--
-- Nullable, and null on every row the four existing sweeps write. Their
-- identity strings gain a trailing empty segment and nothing else changes.
alter table alignment_findings add column subject_key_result_id uuid
  references key_results (id) on delete cascade;

-- The read a key result's own panel would make.
create index alignment_findings_key_result_idx
  on alignment_findings (workspace_id, subject_key_result_id)
  where deleted_at is null and subject_key_result_id is not null;

-- **`alignment_findings_identity_idx` is deliberately not widened.** It is
-- scoped `where source = 'engine'`, and the engine writes no key-result
-- finding, so every row it covers holds null here and the index means exactly
-- what it did. The coach's rows are reconciled by `reconcileFindingsInTx` in
-- application code, which is where the widened identity lives.
