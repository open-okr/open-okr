-- The Postgres full-text search driver's index (TECHNICAL-PLAN §5, §9).
--
-- A projection of other rows, refreshed by outbox-driven jobs. Queries return
-- identifiers and a rank; the caller reloads each hit through the
-- access-aware getter, so the index can never widen what someone may see.

-- openokr:hard-delete: this is a projection, not a record. When a source row
-- is soft-deleted its projection is removed outright, because a surviving
-- index entry would leak a deleted title into someone's search results.
create table search_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  title text not null,
  -- Plain text, extracted from rich text by the caller before indexing.
  body text,
  -- Title matches outrank body matches.
  document tsvector generated always as (
    setweight(to_tsvector('english', title), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) stored,
  updated_at timestamptz not null default now(),
  unique (workspace_id, entity_type, entity_id)
);

alter table search_documents enable row level security;
alter table search_documents force row level security;

create policy tenant_isolation on search_documents
  using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
  with check (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid);

create index search_documents_document_idx on search_documents using gin (document);
