-- Who may reopen a closed workspace (docs/design/workspace-erasure.md §3).
--
-- True only when the workspace's own owner closed it while it was active. Closing
-- one that billing made read-only and then reopening it must not become the way
-- out of paying, and a closure the provider made is the provider's to undo. Every
-- other move sets it back to false.
--
-- No default true for existing rows: a workspace closed before this column existed
-- was closed by an operator, the only door there was, so false is what it means.
ALTER TABLE tenants
  ADD COLUMN owner_may_reopen boolean NOT NULL DEFAULT false;
