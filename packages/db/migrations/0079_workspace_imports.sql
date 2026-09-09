-- Workspace archive imports (TECHNICAL-PLAN §4.13, P6-T05b).
--
-- One row per import attempt: dry runs and real runs both recorded, so an
-- operator can see what a dry run predicted before the real one ran. The
-- unique index on (workspace_id, archive_digest) for real runs is what
-- makes a re-import a no-op: the second attempt finds the first and
-- returns its report.

CREATE TABLE workspace_imports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  archive_digest text NOT NULL,
  manifest      jsonb NOT NULL,
  mode          text NOT NULL CHECK (mode IN ('dry_run', 'real')),
  status        text NOT NULL DEFAULT 'running'
                CHECK (status IN ('running', 'done', 'failed')),
  report        jsonb NOT NULL DEFAULT '{}',
  progress      jsonb NOT NULL DEFAULT '{}',
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

ALTER TABLE workspace_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_imports FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_imports_tenant ON workspace_imports
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);

CREATE UNIQUE INDEX workspace_imports_digest_uniq
  ON workspace_imports (workspace_id, archive_digest)
  WHERE mode = 'real' AND deleted_at IS NULL;
